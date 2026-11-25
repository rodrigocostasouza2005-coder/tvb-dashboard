import { describe, it, expect, vi, beforeEach } from "vitest";

// Bug real achado em 2026-11-25 (ver comentário em getDailySalesByProduto, vendas.ts): o merge de
// devolução por dia fazia `const cur = byDay.get(day); if (!cur) continue;` — se o dia da
// devolução não tinha nenhuma linha de VENDA daquele produto (ex: comprado num dia, devolvido
// numa visita/pedido em outro dia; ou devolvido num dia em que o produto simplesmente não vendeu
// nada), a devolução inteira era descartada em silêncio, sumindo do gráfico e do total líquido.
// Corrigido pra sempre criar a entrada do dia quando falta (venda bruta 0, devolução real).

const queryRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
  },
}));

const baseFilters = {
  from: new Date("2026-11-01T00:00:00.000-03:00"),
  to: new Date("2026-11-30T23:59:59.999-03:00"),
  storeIds: undefined,
  marcas: undefined as string[] | undefined,
  tabelasPreco: undefined,
  grupoIn: undefined,
};

describe("getDailySalesByProduto — devolução em dia sem venda não é descartada", () => {
  beforeEach(() => {
    queryRaw.mockReset();
  });

  it("devolução no MESMO dia da venda neta corretamente (comportamento normal preservado)", async () => {
    queryRaw
      .mockResolvedValueOnce([{ day: new Date("2026-11-10"), units: BigInt(10), revenue: 1000 }])
      .mockResolvedValueOnce([{ day: new Date("2026-11-10"), units: BigInt(3), value: 300 }]);

    const { getDailySalesByProduto } = await import("../vendas");
    const result = await getDailySalesByProduto(baseFilters, "Camiseta Azul");

    expect(result).toEqual([
      { day: "2026-11-10", unitsBruta: 10, unitsLiquida: 7, revenueBruta: 1000, revenueLiquida: 700 },
    ]);
  });

  it("devolução em dia DIFERENTE da venda cria a própria entrada, não é descartada", async () => {
    queryRaw
      .mockResolvedValueOnce([{ day: new Date("2026-11-10"), units: BigInt(10), revenue: 1000 }])
      .mockResolvedValueOnce([{ day: new Date("2026-11-15"), units: BigInt(2), value: 200 }]);

    const { getDailySalesByProduto } = await import("../vendas");
    const result = await getDailySalesByProduto(baseFilters, "Camiseta Azul");

    expect(result).toEqual([
      { day: "2026-11-10", unitsBruta: 10, unitsLiquida: 10, revenueBruta: 1000, revenueLiquida: 1000 },
      { day: "2026-11-15", unitsBruta: 0, unitsLiquida: -2, revenueBruta: 0, revenueLiquida: -200 },
    ]);
  });

  it("devolução num dia em que o produto não teve NENHUMA venda no período inteiro ainda aparece", async () => {
    queryRaw
      .mockResolvedValueOnce([]) // nenhuma venda no período
      .mockResolvedValueOnce([{ day: new Date("2026-11-20"), units: BigInt(1), value: 150 }]);

    const { getDailySalesByProduto } = await import("../vendas");
    const result = await getDailySalesByProduto(baseFilters, "Camiseta Azul");

    expect(result).toEqual([
      { day: "2026-11-20", unitsBruta: 0, unitsLiquida: -1, revenueBruta: 0, revenueLiquida: -150 },
    ]);
  });

  it("receita bruta vs líquida coerente com múltiplos dias (venda, venda+devolução, só devolução)", async () => {
    queryRaw
      .mockResolvedValueOnce([
        { day: new Date("2026-11-05"), units: BigInt(5), revenue: 500 },
        { day: new Date("2026-11-10"), units: BigInt(10), revenue: 1000 },
      ])
      .mockResolvedValueOnce([
        { day: new Date("2026-11-10"), units: BigInt(4), value: 400 },
        { day: new Date("2026-11-18"), units: BigInt(1), value: 100 },
      ]);

    const { getDailySalesByProduto } = await import("../vendas");
    const result = await getDailySalesByProduto(baseFilters, "Camiseta Azul");

    expect(result).toEqual([
      { day: "2026-11-05", unitsBruta: 5, unitsLiquida: 5, revenueBruta: 500, revenueLiquida: 500 },
      { day: "2026-11-10", unitsBruta: 10, unitsLiquida: 6, revenueBruta: 1000, revenueLiquida: 600 },
      { day: "2026-11-18", unitsBruta: 0, unitsLiquida: -1, revenueBruta: 0, revenueLiquida: -100 },
    ]);
  });
});
