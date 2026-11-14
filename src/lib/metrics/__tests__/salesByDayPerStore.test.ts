import { describe, it, expect, vi, beforeEach } from "vitest";

const queryRaw = vi.fn();
const storeFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    store: { findMany: (...a: unknown[]) => storeFindMany(...a) },
  },
}));

const baseFilters = {
  from: new Date("2026-11-10T00:00:00.000-03:00"),
  to: new Date("2026-11-10T23:59:59.999-03:00"),
  storeIds: undefined,
  marcas: undefined as string[] | undefined,
  tabelasPreco: undefined,
  grupoIn: undefined,
  colecaoIn: undefined,
};

// Achado em 2026-11-14: Rodrigo viu TVB Barra/Leblon/Rio Sul com unidades líquidas negativas no
// "Comparativo entre lojas" (Visão Geral e Vendas) em 10/11. Causa: a query de Sale filtrava por
// "marca" = ANY(filters.marcas) sem passthrough de null, excluindo venda com marca ainda não
// inferida; a query de Return nunca filtra por marca (não é populado de forma confiável). Uma
// loja com, digamos, 70 vendas de marca=null e 6 devoluções virava liquido = 0 - 6 = -6.
describe("getSalesByDayPerStore — marca=null não pode sumir do lado Sale quando devolução conta inteira", () => {
  beforeEach(() => {
    queryRaw.mockReset();
    storeFindMany.mockReset();
  });

  // ${filters.marcas !== undefined ? Prisma.sql`...` : Prisma.empty} é um fragmento Prisma.Sql
  // próprio (tem .sql/.strings/.values), interpolado como UM DOS VALORES da tagged template
  // externa — não aparece no join() das strings literais externas. Precisa achar esse valor
  // entre os argumentos da chamada e ler o .sql dele.
  function sqlDeTodosOsFragmentos(call: unknown[]): string {
    return call
      .slice(1)
      .filter((v): v is { sql: string } => typeof v === "object" && v !== null && "sql" in v)
      .map((v) => v.sql)
      .join(" | ");
  }

  it("a query de Sale inclui OR \"marca\" IS NULL quando filtro de marca está ativo", async () => {
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    storeFindMany.mockResolvedValueOnce([]);

    const { getSalesByDayPerStore } = await import("../vendas");
    await getSalesByDayPerStore({ ...baseFilters, marcas: ["TVBSHORTS"] });

    const fragmentosDaVenda = sqlDeTodosOsFragmentos(queryRaw.mock.calls[0]);
    expect(fragmentosDaVenda).toContain('"marca" = ANY');
    expect(fragmentosDaVenda).toContain('OR "marca" IS NULL');
  });

  it("a query de Return nunca filtra por marca, mesmo com filtro de marca ativo (comportamento preservado)", async () => {
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    storeFindMany.mockResolvedValueOnce([]);

    const { getSalesByDayPerStore } = await import("../vendas");
    await getSalesByDayPerStore({ ...baseFilters, marcas: ["TVBSHORTS"] });

    const fragmentosDaDevolucao = sqlDeTodosOsFragmentos(queryRaw.mock.calls[1]);
    expect(fragmentosDaDevolucao).not.toContain("marca");
  });

  it("regressão do caso real: 70 vendas (marca=null) e 6 devoluções na mesma loja/dia resultam em líquido positivo, não -6", async () => {
    const storeId = "store-barra";
    queryRaw
      .mockResolvedValueOnce([{ day: new Date("2026-11-10"), storeId, units: BigInt(70) }])
      .mockResolvedValueOnce([{ day: new Date("2026-11-10"), storeId, units: BigInt(6) }]);
    storeFindMany.mockResolvedValueOnce([{ id: storeId, name: "TVB Barra", displayGroup: null }]);

    const { getSalesByDayPerStore } = await import("../vendas");
    const result = await getSalesByDayPerStore({ ...baseFilters, marcas: ["TVBSHORTS"] });

    expect(result.data).toEqual([{ day: "2026-11-10", "TVB Barra": 64 }]);
  });
});
