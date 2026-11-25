import { describe, it, expect, vi, beforeEach } from "vitest";

// Bug real achado em 2026-11-25 (baixa prioridade, ver comentário em getVendedorRanking,
// vendas.ts): "pedidos" vinha de `r._count._all` no groupBy por ["storeId","vendedor"] — isso
// conta LINHA de item vendido, não pedido distinto (1 pedido pode ter várias linhas/produtos),
// inconsistente com getSalesByStore/getMonthlySnapshotKpi (mesmo arquivo), que já agrupam por
// (storeId, dapicVendaId) pra contar pedido de verdade. Corrigido pra usar o mesmo padrão.

const saleGroupBy = vi.fn();
const storeFindMany = vi.fn();
const returnFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sale: { groupBy: (...a: unknown[]) => saleGroupBy(...a) },
    store: { findMany: (...a: unknown[]) => storeFindMany(...a) },
    return: { findMany: (...a: unknown[]) => returnFindMany(...a) },
  },
}));

const baseFilters = {
  from: new Date("2026-11-01T00:00:00.000-03:00"),
  to: new Date("2026-11-30T23:59:59.999-03:00"),
  storeIds: undefined,
  marcas: undefined as string[] | undefined,
  tabelasPreco: undefined,
  grupoIn: undefined,
  colecaoIn: undefined,
};

describe("getVendedorRanking — pedidos conta PEDIDO distinto, não linha de item", () => {
  beforeEach(() => {
    saleGroupBy.mockReset();
    storeFindMany.mockReset();
    returnFindMany.mockReset();
    returnFindMany.mockResolvedValue([]); // getDevolvidoPorVendedor
    storeFindMany.mockResolvedValue([{ id: "store-leblon", name: "TVB Leblon" }]);
  });

  it("1 pedido com 3 linhas de produto conta como 1 pedido, não 3", async () => {
    saleGroupBy
      // 1ª chamada: groupBy ["storeId","vendedor"] — totais.
      .mockResolvedValueOnce([
        { storeId: "store-leblon", vendedor: "Ana", _sum: { quantidade: 6, valorTotalLiquido: 600 } },
      ])
      // 2ª chamada: groupBy ["storeId","vendedor","dapicVendaId"] — pra contar pedido distinto.
      // Mesmo dapicVendaId=10 repetido 3x simula as 3 linhas de item do mesmo pedido.
      .mockResolvedValueOnce([
        { storeId: "store-leblon", vendedor: "Ana", dapicVendaId: 10 },
        { storeId: "store-leblon", vendedor: "Ana", dapicVendaId: 10 },
        { storeId: "store-leblon", vendedor: "Ana", dapicVendaId: 10 },
      ]);

    const { getVendedorRanking } = await import("../vendas");
    const result = await getVendedorRanking(baseFilters);

    expect(result).toEqual([
      {
        vendedor: "Ana",
        storeName: "TVB Leblon",
        pedidos: 1,
        unidadesBrutas: 6,
        unidadesLiquidas: 6,
        receitaBruta: 600,
        receitaLiquida: 600,
      },
    ]);
  });

  it("2 pedidos distintos do mesmo vendedor contam como 2, não como a soma de linhas", async () => {
    saleGroupBy
      .mockResolvedValueOnce([
        { storeId: "store-leblon", vendedor: "Ana", _sum: { quantidade: 4, valorTotalLiquido: 400 } },
      ])
      .mockResolvedValueOnce([
        { storeId: "store-leblon", vendedor: "Ana", dapicVendaId: 10 },
        { storeId: "store-leblon", vendedor: "Ana", dapicVendaId: 10 },
        { storeId: "store-leblon", vendedor: "Ana", dapicVendaId: 11 },
      ]);

    const { getVendedorRanking } = await import("../vendas");
    const result = await getVendedorRanking(baseFilters);

    expect(result[0].pedidos).toBe(2);
  });
});
