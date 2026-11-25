import { describe, it, expect, vi, beforeEach } from "vitest";

// Bug real achado em 2026-11-25 (ver comentário em getTopParaIncentivar, vendas.ts): a função
// montava seu próprio `where` pra prisma.sale.groupBy (só saleDate+storeId), em vez de usar
// saleWhere(filters) — a regra central de "venda válida" (status != 'Cancelada', core.ts) não se
// aplicava, então venda cancelada contava como "vendido" e escondia produto que precisava de
// incentivo (diferença artificialmente menor por "vendido" inflado).

const stockSnapshotGroupBy = vi.fn();
const saleGroupBy = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stockSnapshot: { groupBy: (...a: unknown[]) => stockSnapshotGroupBy(...a) },
    sale: { groupBy: (...a: unknown[]) => saleGroupBy(...a) },
  },
}));

beforeEach(() => {
  stockSnapshotGroupBy.mockReset();
  saleGroupBy.mockReset();
});

describe("getTopParaIncentivar — exclui venda cancelada do cálculo de 'vendido'", () => {
  it("a query de Sale inclui status != 'Cancelada' (via saleWhere)", async () => {
    stockSnapshotGroupBy.mockResolvedValueOnce([]);
    saleGroupBy.mockResolvedValueOnce([]);

    const { getTopParaIncentivar } = await import("../vendas");
    await getTopParaIncentivar(30, 10, ["store-leblon"]);

    expect(saleGroupBy).toHaveBeenCalledTimes(1);
    const [{ where }] = saleGroupBy.mock.calls[0] as [{ where: { status?: { not: string }; storeId?: { in: string[] } } }];
    expect(where.status).toEqual({ not: "Cancelada" });
    expect(where.storeId).toEqual({ in: ["store-leblon"] });
  });

  it("venda cancelada não conta como 'vendido' — produto com venda só cancelada aparece com vendido=0, não escondido do ranking", async () => {
    stockSnapshotGroupBy.mockResolvedValueOnce([
      { produto: "Camiseta Parada", _sum: { quantidadeDisponivel: 50 } },
    ]);
    // saleWhere já filtra status != Cancelada antes de chegar no banco de verdade — aqui simulamos
    // o retorno JÁ sem a venda cancelada (o teste acima garante que o filtro foi passado certo).
    saleGroupBy.mockResolvedValueOnce([]);

    const { getTopParaIncentivar } = await import("../vendas");
    const result = await getTopParaIncentivar(30, 10);

    expect(result).toEqual([{ produto: "Camiseta Parada", estoque: 50, vendido: 0, diferenca: 50 }]);
  });

  it("venda normal (não cancelada) continua contando normalmente — sem regressão", async () => {
    stockSnapshotGroupBy.mockResolvedValueOnce([
      { produto: "Camiseta Vendida", _sum: { quantidadeDisponivel: 50 } },
    ]);
    saleGroupBy.mockResolvedValueOnce([{ produto: "Camiseta Vendida", _sum: { quantidade: 20 } }]);

    const { getTopParaIncentivar } = await import("../vendas");
    const result = await getTopParaIncentivar(30, 10);

    expect(result).toEqual([{ produto: "Camiseta Vendida", estoque: 50, vendido: 20, diferenca: 30 }]);
  });
});
