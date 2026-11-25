import { describe, it, expect, vi, beforeEach } from "vitest";

// Auditoria 2026-11-25: getStockCoverage usa estoque (numerador) sem filtro de Tabela de Preço e
// vendas 30d (denominador) COM esse filtro — StockSnapshot não tem coluna tabelaPreco, então essa
// assimetria é intencional e documentada no código, não um bug pendente. Este teste trava que o
// comportamento documentado continua sendo o implementado (se alguém "corrigir" sem querer
// filtrando o estoque também, ou destravar o filtro de vendas, este teste denuncia a mudança).

const stockSnapshotFindMany = vi.fn();
const saleGroupBy = vi.fn();
const storeFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stockSnapshot: { findMany: (...a: unknown[]) => stockSnapshotFindMany(...a) },
    sale: { groupBy: (...a: unknown[]) => saleGroupBy(...a) },
    store: { findMany: (...a: unknown[]) => storeFindMany(...a) },
  },
}));

beforeEach(() => {
  stockSnapshotFindMany.mockReset().mockResolvedValue([
    { storeId: "loja-1", cod: "100", grupo: "Camisetas", produto: "X", tamanho: "P", colecao: null, quantidadeDisponivel: 10 },
  ]);
  saleGroupBy.mockReset().mockResolvedValue([]);
  storeFindMany.mockReset().mockResolvedValue([{ id: "loja-1", name: "Loja 1" }]);
});

describe("getStockCoverage — tabelasPreco filtra só o denominador (vendas), nunca o numerador (estoque)", () => {
  it("where de sale.groupBy inclui tabelaPreco quando o filtro é fornecido", async () => {
    const { getStockCoverage } = await import("../estoque");
    await getStockCoverage({ storeIds: undefined, grupoIn: undefined, tabelasPreco: ["VAREJO"] });

    expect(saleGroupBy.mock.calls[0][0].where).toMatchObject({ tabelaPreco: { in: ["VAREJO"] } });
  });

  it("stockSnapshot.findMany nunca recebe where.tabelaPreco (StockSnapshot não tem essa coluna)", async () => {
    const { getStockCoverage } = await import("../estoque");
    await getStockCoverage({ storeIds: undefined, grupoIn: undefined, tabelasPreco: ["VAREJO"] });

    expect(stockSnapshotFindMany.mock.calls[0][0].where).not.toHaveProperty("tabelaPreco");
  });

  it("resultado continua contando a unidade de estoque mesmo com filtro de tabela de preço ativo (limitação documentada, não erro)", async () => {
    const { getStockCoverage } = await import("../estoque");
    const rows = await getStockCoverage({ storeIds: undefined, grupoIn: undefined, tabelasPreco: ["VAREJO"] });

    expect(rows).toHaveLength(1);
    expect(rows[0].estoque).toBe(10);
  });
});
