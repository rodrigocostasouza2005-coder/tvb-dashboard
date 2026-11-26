import { describe, it, expect, vi, beforeEach } from "vitest";

// Bug real (auditoria Pesquisa/Marketing, 2026-11-26): a coluna "Vendido no período" da aba
// Pesquisa (pesquisa-table.tsx) vinha de searchStockVsSalesComTamanhos -> getStockVsSales
// (estoque.ts), que nunca descontava devolução — bruto de verdade, sem nenhum aviso na tela,
// inconsistente com Top 10 Mais/Menos Vendidos (líquido desde 2026-08-24). Corrigido: busca a
// devolução por produto no mesmo filtro e desconta localmente (netByReturns), sem alterar
// getStockVsSales (compartilhada com Marketing, que rotula honestamente "(bruto)" pro mesmo
// dado, e com Atacado/Clientes/Custo por Família).

const getSalesByDimension = vi.fn();
const getReturnsByDimension = vi.fn();
const latestStockSnapshots = vi.fn();
const stockSnapshotGroupBy = vi.fn();
const storeFindMany = vi.fn();
const productionOrderGroupBy = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stockSnapshot: {
      groupBy: (...a: unknown[]) => stockSnapshotGroupBy(...a),
      findMany: vi.fn().mockResolvedValue([]),
    },
    store: { findMany: (...a: unknown[]) => storeFindMany(...a) },
    productionOrder: { groupBy: (...a: unknown[]) => productionOrderGroupBy(...a) },
  },
}));

vi.mock("../vendas", async () => {
  const actual = await vi.importActual<typeof import("../vendas")>("../vendas");
  return {
    ...actual,
    getSalesByDimension: (...a: unknown[]) => getSalesByDimension(...a),
    getReturnsByDimension: (...a: unknown[]) => getReturnsByDimension(...a),
  };
});

vi.mock("../core", async () => {
  const actual = await vi.importActual<typeof import("../core")>("../core");
  return {
    ...actual,
    latestStockSnapshots: (...a: unknown[]) => latestStockSnapshots(...a),
  };
});

beforeEach(() => {
  getSalesByDimension.mockReset();
  getReturnsByDimension.mockReset();
  latestStockSnapshots.mockReset().mockResolvedValue([]);
  stockSnapshotGroupBy.mockReset().mockResolvedValue([]);
  storeFindMany.mockReset().mockResolvedValue([]);
  productionOrderGroupBy.mockReset().mockResolvedValue([]);
});

describe("searchStockVsSalesComTamanhos — Pesquisa desconta devolução (líquido, não bruto)", () => {
  it("desconta devolução do produto da coluna Vendido no período", async () => {
    getSalesByDimension.mockResolvedValue([{ key: "Produto A", unitsSold: 20, revenue: 1000 }]);
    getReturnsByDimension.mockResolvedValue([{ key: "Produto A", unitsReturned: 5, value: 250 }]);

    const { searchStockVsSalesComTamanhos } = await import("../estoque");
    const { rows } = await searchStockVsSalesComTamanhos(
      { from: new Date("2026-01-01"), to: new Date("2026-01-31"), storeIds: undefined, marcas: undefined, tabelasPreco: undefined, grupoIn: undefined, tamanhoIn: undefined, colecaoIn: undefined },
      ""
    );

    const produtoA = rows.find((r) => r.key === "Produto A");
    // Líquido: 20-5=15 unidades, 1000-250=750 receita. SEM a correção, "Vendido no período"
    // mostrava o bruto (20 / 1000) — essa asserção falha no código antigo (git stash) e passa
    // no novo.
    expect(produtoA?.unitsSold).toBe(15);
    expect(produtoA?.revenue).toBe(750);
    expect(getReturnsByDimension).toHaveBeenCalledWith(expect.anything(), "produto");
  });

  it("produto sem nenhuma devolução não é afetado (sem regressão)", async () => {
    getSalesByDimension.mockResolvedValue([{ key: "Produto B", unitsSold: 8, revenue: 400 }]);
    getReturnsByDimension.mockResolvedValue([]);

    const { searchStockVsSalesComTamanhos } = await import("../estoque");
    const { rows } = await searchStockVsSalesComTamanhos(
      { from: new Date("2026-02-01"), to: new Date("2026-02-28"), storeIds: undefined, marcas: undefined, tabelasPreco: undefined, grupoIn: undefined, tamanhoIn: undefined, colecaoIn: undefined },
      ""
    );

    const produtoB = rows.find((r) => r.key === "Produto B");
    expect(produtoB?.unitsSold).toBe(8);
    expect(produtoB?.revenue).toBe(400);
  });
});
