import { describe, it, expect, vi, beforeEach } from "vitest";

const storeFindMany = vi.fn();
const saleGroupBy = vi.fn();
const stockSnapshotFindMany = vi.fn();
const estoqueMinimoManualFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: (...a: unknown[]) => storeFindMany(...a) },
    sale: { groupBy: (...a: unknown[]) => saleGroupBy(...a) },
    stockSnapshot: { findMany: (...a: unknown[]) => stockSnapshotFindMany(...a) },
    estoqueMinimoManual: { findMany: (...a: unknown[]) => estoqueMinimoManualFindMany(...a) },
  },
}));

vi.mock("../compras-inteligencia", () => ({
  getVendaMediaDiariaPorCod: vi.fn().mockResolvedValue(new Map()),
}));

// Fixture realista: 1 loja de verdade (vende, não é insumo) + 1 armazém "Defeito" que tem
// sellsProducts=true (bug histórico documentado em armazenadores.ts) mas nunca vendeu — é
// exatamente o critério 2 de getPosicoesEstoque (venda real) que separa os dois, não o nome.
const LOJA_REAL = { id: "store-leblon", name: "Leblon", code: "LEBLON", displayGroup: "Loja Leblon", sellsProducts: true };
const ARMAZEM_DEFEITO = { id: "store-defeito", name: "Defeito", code: "DEFEITO", displayGroup: "Defeito", sellsProducts: true };

// Estoque TOTAL "na gaveta" por posição (como o DAPIC sincroniza) — inclui o armazém de defeito.
const STOCK_ROWS_TOTAL = [
  { cod: "COD-1", produto: "Camisa Polo", grupo: "Polos", cor: "Azul", tamanho: "M", colecao: "BESTSELLER", quantidadeDisponivel: 2, storeId: LOJA_REAL.id },
  { cod: "COD-1", produto: "Camisa Polo", grupo: "Polos", cor: "Azul", tamanho: "M", colecao: "BESTSELLER", quantidadeDisponivel: 19, storeId: ARMAZEM_DEFEITO.id },
];

describe("getReposicaoBestSellerConsolidada — exclui armazém não-comercial (achado real, auditoria 2026-11-26)", () => {
  beforeEach(() => {
    storeFindMany.mockReset();
    saleGroupBy.mockReset();
    stockSnapshotFindMany.mockReset();
    estoqueMinimoManualFindMany.mockReset();

    storeFindMany.mockResolvedValue([LOJA_REAL, ARMAZEM_DEFEITO]);
    saleGroupBy.mockResolvedValue([{ storeId: LOJA_REAL.id, _count: { _all: 500 } }]); // só a loja real vendeu
    estoqueMinimoManualFindMany.mockResolvedValue([{ cod: "COD-1", valor: 10 }]);

    // Simula o filtro real do banco: stockSnapshot.findMany só devolve as linhas cujo storeId
    // está no "in" passado — é exatamente esse "in" que o bug/fix decidem.
    stockSnapshotFindMany.mockImplementation(async (args: { where?: { storeId?: { in?: string[] } } }) => {
      const allowed = args?.where?.storeId?.in;
      if (!allowed) return STOCK_ROWS_TOTAL;
      return STOCK_ROWS_TOTAL.filter((r) => allowed.includes(r.storeId));
    });
  });

  it("quantidadeDisponivel soma só a posição comercial real (2), não os 19 do armazém de defeito que nunca vendeu", async () => {
    const { getReposicaoBestSellerConsolidada } = await import("../reposicao-bestseller-consolidada");
    const itens = await getReposicaoBestSellerConsolidada({});

    expect(itens).toHaveLength(1);
    // Com o bug antigo, quantidadeDisponivel seria 21 (2+19) e falta ficaria 10-21=-11 (item nem
    // apareceria, porque já pareceria "OK" — mascarando uma falta real de 8 unidades).
    expect(itens[0].quantidadeDisponivel).toBe(2);
    expect(itens[0].falta).toBe(8);
  });

  it("stockSnapshot.findMany nunca é chamado com o storeId do armazém de defeito no filtro", async () => {
    const { getReposicaoBestSellerConsolidada } = await import("../reposicao-bestseller-consolidada");
    await getReposicaoBestSellerConsolidada({});

    const chamada = stockSnapshotFindMany.mock.calls[0][0] as { where: { storeId: { in: string[] } } };
    expect(chamada.where.storeId.in).toContain(LOJA_REAL.id);
    expect(chamada.where.storeId.in).not.toContain(ARMAZEM_DEFEITO.id);
  });
});
