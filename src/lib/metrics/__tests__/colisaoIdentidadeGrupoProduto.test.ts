import { describe, it, expect, vi, beforeEach } from "vitest";

// Bug real achado em auditoria 2026-11-25: getSalesByGrupoProduto/getReturnsByGrupoProduto
// (vendas.ts) agrupam por grupo+produto no Prisma (groupBy by: ["grupo","produto"]), mas
// exportavam a chave de identidade só como `key: r.produto` — nome de produto NÃO é único entre
// grupos (ex.: "Clássico" existe em Camisetas e em Shorts). Qualquer consumidor que indexasse
// por essa chave (o principal: netByReturns em core.ts, usado por Top 10 Mais/Menos Vendidos e
// pela Central Black Friday) misturava receita/devolução de produtos de grupos diferentes que só
// coincidem no nome. Corrigido pra `key: \`${grupo}::${produto}\`` nas duas funções.

const saleGroupBy = vi.fn();
const returnGroupBy = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sale: { groupBy: (...a: unknown[]) => saleGroupBy(...a) },
    return: { groupBy: (...a: unknown[]) => returnGroupBy(...a) },
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
  returnGroupBy.mockReset();
});

describe("getSalesByGrupoProduto — chave de identidade composta grupo+produto", () => {
  it("dois produtos com o MESMO nome em grupos DIFERENTES ficam em entradas separadas, com key única", async () => {
    saleGroupBy.mockResolvedValueOnce([
      { grupo: "Camisetas", produto: "Clássico", _sum: { quantidade: 10, valorTotalLiquido: 1000 } },
      { grupo: "Shorts", produto: "Clássico", _sum: { quantidade: 5, valorTotalLiquido: 500 } },
    ]);

    const { getSalesByGrupoProduto } = await import("../vendas");
    const rows = await getSalesByGrupoProduto(baseFilters);

    expect(rows).toHaveLength(2);
    const keys = rows.map((r) => r.key);
    // A asserção real: as duas keys são DIFERENTES (não colidem), não só "existem 2 linhas".
    expect(new Set(keys).size).toBe(2);
    expect(keys).toContain("Camisetas::Clássico");
    expect(keys).toContain("Shorts::Clássico");

    const camisetas = rows.find((r) => r.key === "Camisetas::Clássico")!;
    const shorts = rows.find((r) => r.key === "Shorts::Clássico")!;
    expect(camisetas.produto).toBe("Clássico");
    expect(camisetas.grupo).toBe("Camisetas");
    expect(camisetas.unitsSold).toBe(10);
    expect(camisetas.revenue).toBe(1000);
    expect(shorts.unitsSold).toBe(5);
    expect(shorts.revenue).toBe(500);
  });
});

describe("getReturnsByGrupoProduto — chave de identidade composta grupo+produto", () => {
  it("dois produtos com o MESMO nome em grupos DIFERENTES ficam em entradas separadas, com key única", async () => {
    returnGroupBy.mockResolvedValueOnce([
      { grupo: "Camisetas", produto: "Clássico", _sum: { quantidade: 2, valorTotal: 200 } },
      { grupo: "Shorts", produto: "Clássico", _sum: { quantidade: 1, valorTotal: 100 } },
    ]);

    const { getReturnsByGrupoProduto } = await import("../vendas");
    const rows = await getReturnsByGrupoProduto(baseFilters);

    expect(rows).toHaveLength(2);
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(2);

    const camisetas = rows.find((r) => r.key === "Camisetas::Clássico")!;
    const shorts = rows.find((r) => r.key === "Shorts::Clássico")!;
    expect(camisetas.unitsReturned).toBe(2);
    expect(camisetas.value).toBe(200);
    expect(shorts.unitsReturned).toBe(1);
    expect(shorts.value).toBe(100);
  });
});

describe("netByReturns (core.ts) — com a key composta, não mistura devolução entre grupos", () => {
  it("devolução de Shorts::Clássico NUNCA desconta de Camisetas::Clássico (bug real antes da correção)", async () => {
    saleGroupBy.mockResolvedValueOnce([
      { grupo: "Camisetas", produto: "Clássico", _sum: { quantidade: 10, valorTotalLiquido: 1000 } },
      { grupo: "Shorts", produto: "Clássico", _sum: { quantidade: 5, valorTotalLiquido: 500 } },
    ]);
    returnGroupBy.mockResolvedValueOnce([
      { grupo: "Camisetas", produto: "Clássico", _sum: { quantidade: 2, valorTotal: 200 } },
      { grupo: "Shorts", produto: "Clássico", _sum: { quantidade: 1, valorTotal: 100 } },
    ]);

    const { getSalesByGrupoProduto, getReturnsByGrupoProduto } = await import("../vendas");
    const { netByReturns } = await import("../core");

    const vendas = await getSalesByGrupoProduto(baseFilters);
    const devolucoes = await getReturnsByGrupoProduto(baseFilters);
    const liquido = netByReturns(vendas, devolucoes);

    const camisetas = liquido.find((r) => r.key === "Camisetas::Clássico")!;
    const shorts = liquido.find((r) => r.key === "Shorts::Clássico")!;
    // Antes da correção (key = só "Clássico" nos dois), o Map de netByReturns tinha 1 entrada só
    // (a última sobrescrevia a primeira) e AMBOS os produtos acabavam descontando a MESMA
    // devolução — aqui cada um precisa descontar exatamente a sua.
    expect(camisetas.unitsSold).toBe(8); // 10 - 2
    expect(camisetas.revenue).toBe(800); // 1000 - 200
    expect(shorts.unitsSold).toBe(4); // 5 - 1
    expect(shorts.revenue).toBe(400); // 500 - 100
  });
});
