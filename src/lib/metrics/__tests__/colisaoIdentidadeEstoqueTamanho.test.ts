import { describe, it, expect, vi, beforeEach } from "vitest";

// Mesma família de bug de colisaoIdentidadeGrupoProduto.test.ts (vendas.ts), agora do lado de
// estoque: getEstoqueAtualPorGrupoProduto e getTamanhoBreakdown (estoque.ts) podiam misturar
// estoque/tamanho de dois produtos com o MESMO nome em grupos DIFERENTES (ex.: "Clássico" em
// Camisetas e em Shorts) — achado em auditoria 2026-11-25.

const saleGroupBy = vi.fn();
const stockSnapshotFindMany = vi.fn();
const priceCatalogFindUnique = vi.fn();
const priceCatalogFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sale: { groupBy: (...a: unknown[]) => saleGroupBy(...a) },
    stockSnapshot: { findMany: (...a: unknown[]) => stockSnapshotFindMany(...a) },
    priceCatalogCache: {
      findUnique: (...a: unknown[]) => priceCatalogFindUnique(...a),
      findFirst: (...a: unknown[]) => priceCatalogFindFirst(...a),
    },
  },
}));

const baseFilters = {
  from: new Date("2026-11-01T00:00:00.000-03:00"),
  to: new Date("2026-11-30T23:59:59.999-03:00"),
  storeIds: undefined as string[] | undefined,
  marcas: undefined as string[] | undefined,
  tabelasPreco: undefined as string[] | undefined,
  grupoIn: undefined as string[] | undefined,
  colecaoIn: undefined as string[] | undefined,
};

beforeEach(() => {
  saleGroupBy.mockReset();
  stockSnapshotFindMany.mockReset();
  priceCatalogFindUnique.mockReset().mockResolvedValue(null);
  priceCatalogFindFirst.mockReset().mockResolvedValue(null);
  // getVarejoPriceMap (estoque.ts) tem cache em memória por módulo — sem resetModules, o 2º
  // teste reaproveitaria o Map vazio cacheado do 1º (inofensivo aqui, mas evita acoplar testes).
  vi.resetModules();
});

describe("getEstoqueAtualPorGrupoProduto — chave de identidade composta grupo+produto", () => {
  it("dois produtos com o MESMO nome em grupos DIFERENTES não somam estoque juntos", async () => {
    stockSnapshotFindMany.mockResolvedValueOnce([
      { storeId: "s1", cod: "C1", grupo: "Camisetas", produto: "Clássico", tamanho: "M", colecao: null, quantidadeDisponivel: 10, estoqueMinimo: null, valorCusto: 5 },
      { storeId: "s1", cod: "C2", grupo: "Shorts", produto: "Clássico", tamanho: "M", colecao: null, quantidadeDisponivel: 7, estoqueMinimo: null, valorCusto: 3 },
    ]);

    const { getEstoqueAtualPorGrupoProduto } = await import("../estoque");
    const rows = await getEstoqueAtualPorGrupoProduto({ storeIds: undefined, grupoIn: undefined });

    expect(rows).toHaveLength(2);
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(2);
    expect(keys).toContain("Camisetas::Clássico");
    expect(keys).toContain("Shorts::Clássico");

    const camisetas = rows.find((r) => r.key === "Camisetas::Clássico")!;
    const shorts = rows.find((r) => r.key === "Shorts::Clássico")!;
    // Bug real: antes da correção, as duas quantidades apareciam sob a mesma `key` ("Clássico"),
    // então um lookup por key (Map em top-mais-vendidos/top-menos-vendidos) só via UMA das duas
    // (nunca 17, que seria o bug OPOSTO de somar errado — aqui o erro é perder uma das duas).
    expect(camisetas.quantidade).toBe(10);
    expect(camisetas.produto).toBe("Clássico");
    expect(shorts.quantidade).toBe(7);
    expect(shorts.produto).toBe("Clássico");
  });
});

describe("getTamanhoBreakdown — grupo-aware não mistura tamanho/estoque entre grupos", () => {
  it("itens {grupo,produto}: cada grupo recebe sua própria quebra por tamanho, sem mistura", async () => {
    saleGroupBy.mockResolvedValueOnce([
      { grupo: "Camisetas", produto: "Clássico", tamanho: "M", _sum: { quantidade: 20 } },
      { grupo: "Shorts", produto: "Clássico", tamanho: "M", _sum: { quantidade: 9 } },
    ]);
    stockSnapshotFindMany.mockResolvedValueOnce([
      { grupo: "Camisetas", produto: "Clássico", tamanho: "M", quantidadeDisponivel: 10 },
      { grupo: "Shorts", produto: "Clássico", tamanho: "M", quantidadeDisponivel: 7 },
    ]);

    const { getTamanhoBreakdown } = await import("../estoque");
    const result = await getTamanhoBreakdown(baseFilters, [
      { grupo: "Camisetas", produto: "Clássico" },
      { grupo: "Shorts", produto: "Clássico" },
    ]);

    expect(result.get("Camisetas::Clássico")).toEqual([{ tamanho: "M", estoque: 10, vendido: 20 }]);
    expect(result.get("Shorts::Clássico")).toEqual([{ tamanho: "M", estoque: 7, vendido: 9 }]);
    // Nunca uma soma cruzada (30/29) nem undefined pra um dos dois.
    expect(result.size).toBe(2);
  });

  it("itens string (mapa-compras, sem grupo): comportamento antigo preservado — agrega por nome, sem mudança", async () => {
    saleGroupBy.mockResolvedValueOnce([
      { grupo: "Camisetas", produto: "Clássico", tamanho: "M", _sum: { quantidade: 20 } },
      { grupo: "Shorts", produto: "Clássico", tamanho: "M", _sum: { quantidade: 9 } },
    ]);
    stockSnapshotFindMany.mockResolvedValueOnce([
      { grupo: "Camisetas", produto: "Clássico", tamanho: "M", quantidadeDisponivel: 10 },
      { grupo: "Shorts", produto: "Clássico", tamanho: "M", quantidadeDisponivel: 7 },
    ]);

    const { getTamanhoBreakdown } = await import("../estoque");
    const result = await getTamanhoBreakdown(baseFilters, ["Clássico"]);

    // Mesmo grain que mapa-compras já usa hoje (produto puro, sem grupo) — soma os dois grupos
    // numa entrada só, exatamente como antes da correção (nenhuma regressão pra esse caller).
    expect(result.get("Clássico")).toEqual([{ tamanho: "M", estoque: 17, vendido: 29 }]);
    expect(result.size).toBe(1);
  });
});
