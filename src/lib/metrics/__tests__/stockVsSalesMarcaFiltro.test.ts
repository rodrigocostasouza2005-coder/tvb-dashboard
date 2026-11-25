import { describe, it, expect, vi, beforeEach } from "vitest";

// Auditoria 2026-11-25: "Estoque atual" (painel de Estoque × Vendas) ignorava o filtro de Marca —
// StockSnapshot não tem coluna marca, então o filtro é aplicado pós-fetch via um mapa
// produto→marca inferido de Sale (marca é estável 1:1 por produto na base real).

const saleFindMany = vi.fn();
const latestStockSnapshots = vi.fn();
const getSalesByGrupoProdutoTamanho = vi.fn();
const getReturnsByGrupoProdutoTamanho = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { sale: { findMany: (...a: unknown[]) => saleFindMany(...a) } },
}));

vi.mock("../core", async () => {
  const actual = await vi.importActual<typeof import("../core")>("../core");
  return { ...actual, latestStockSnapshots: (...a: unknown[]) => latestStockSnapshots(...a) };
});

vi.mock("../vendas", async () => {
  const actual = await vi.importActual<typeof import("../vendas")>("../vendas");
  return {
    ...actual,
    getSalesByGrupoProdutoTamanho: (...a: unknown[]) => getSalesByGrupoProdutoTamanho(...a),
    getReturnsByGrupoProdutoTamanho: (...a: unknown[]) => getReturnsByGrupoProdutoTamanho(...a),
  };
});

beforeEach(() => {
  saleFindMany.mockReset().mockResolvedValue([
    { produto: "Classic Black", marca: "TVBSHORTS" },
    { produto: "Code Short Vert", marca: "OUTRAMARCA" },
  ]);
  latestStockSnapshots.mockReset().mockResolvedValue([
    { grupo: "Classic Lisa", produto: "Classic Black", tamanho: "36", quantidadeDisponivel: 10 },
    { grupo: "Code", produto: "Code Short Vert", tamanho: "38", quantidadeDisponivel: 5 },
  ]);
  getSalesByGrupoProdutoTamanho.mockReset().mockResolvedValue([]);
  getReturnsByGrupoProdutoTamanho.mockReset().mockResolvedValue([]);
});

describe("getStockVsSalesCombinado — filtro de Marca aplicado ao estoque", () => {
  it("sem filtro de marca, devolve todo o estoque (comportamento anterior preservado)", async () => {
    const { getStockVsSalesCombinado } = await import("../estoque");
    const rows = await getStockVsSalesCombinado({
      from: new Date(), to: new Date(), storeIds: undefined, marcas: undefined, tabelasPreco: undefined, grupoIn: undefined, colecaoIn: undefined,
    });

    expect(rows.find((r) => r.produto === "Classic Black")?.currentStock).toBe(10);
    expect(rows.find((r) => r.produto === "Code Short Vert")?.currentStock).toBe(5);
  });

  it("com filtro de marca, estoque de produto de OUTRA marca não aparece mais", async () => {
    const { getStockVsSalesCombinado } = await import("../estoque");
    const rows = await getStockVsSalesCombinado({
      from: new Date(), to: new Date(), storeIds: undefined, marcas: ["TVBSHORTS"], tabelasPreco: undefined, grupoIn: undefined, colecaoIn: undefined,
    });

    expect(rows.find((r) => r.produto === "Classic Black")?.currentStock).toBe(10);
    expect(rows.find((r) => r.produto === "Code Short Vert")).toBeUndefined();
  });

  it("produto nunca visto em Sale (marca desconhecida) continua passando — null não é marca proibida", async () => {
    latestStockSnapshots.mockResolvedValueOnce([
      { grupo: "Novo", produto: "Produto Nunca Vendido", tamanho: "P", quantidadeDisponivel: 7 },
    ]);
    const { getStockVsSalesCombinado } = await import("../estoque");
    const rows = await getStockVsSalesCombinado({
      from: new Date(), to: new Date(), storeIds: undefined, marcas: ["TVBSHORTS"], tabelasPreco: undefined, grupoIn: undefined, colecaoIn: undefined,
    });

    expect(rows.find((r) => r.produto === "Produto Nunca Vendido")?.currentStock).toBe(7);
  });
});
