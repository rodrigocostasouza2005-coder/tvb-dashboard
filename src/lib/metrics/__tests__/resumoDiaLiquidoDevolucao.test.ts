import { describe, it, expect, vi, beforeEach } from "vitest";

// Bug real (auditoria "resumo executivo", 2026-11-26): getVendasHojeComComparacao e
// getMaisVendidosSemana (vendas.ts) alimentam a aba "Resumo do Dia" e nunca descontavam
// devolução — mesma classe de bug já corrigida em getSalesByDay no mesmo dia em que a aba
// nasceu (2026-09-09, commit 59b5e139 cria a aba bruta; 95cfad50, 3h40min depois, conserta
// getSalesByDay mas nunca propaga pra essas duas funções). Corrigido em 2026-11-26: agora
// agregam Return via returnWhere() no mesmo range de cada janela e subtraem.

const saleAggregate = vi.fn();
const returnAggregate = vi.fn();
const saleGroupBy = vi.fn();
const returnGroupBy = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sale: {
      aggregate: (...a: unknown[]) => saleAggregate(...a),
      groupBy: (...a: unknown[]) => saleGroupBy(...a),
    },
    return: {
      aggregate: (...a: unknown[]) => returnAggregate(...a),
      groupBy: (...a: unknown[]) => returnGroupBy(...a),
    },
  },
}));

const baseFilters = {
  storeIds: undefined as string[] | undefined,
  marcas: undefined as string[] | undefined,
  tabelasPreco: undefined as string[] | undefined,
  grupoIn: undefined as string[] | undefined,
};

beforeEach(() => {
  saleAggregate.mockReset();
  returnAggregate.mockReset();
  saleGroupBy.mockReset();
  returnGroupBy.mockReset();
});

describe("getVendasHojeComComparacao — líquido de devolução (hoje e janela de comparação)", () => {
  it("desconta devolução de hoje e da janela de comparação antes de calcular variação", async () => {
    // Venda bruta: hoje 50 un / R$2.500; comparação (14 dias) 560 un / R$28.000.
    saleAggregate
      .mockResolvedValueOnce({ _sum: { quantidade: 50, valorTotalLiquido: 2500 } })
      .mockResolvedValueOnce({ _sum: { quantidade: 560, valorTotalLiquido: 28000 } });
    // Devolução: hoje 5 un / R$250; comparação 140 un / R$1.400.
    returnAggregate
      .mockResolvedValueOnce({ _sum: { quantidade: 5, valorTotal: 250 } })
      .mockResolvedValueOnce({ _sum: { quantidade: 140, valorTotal: 1400 } });

    const { getVendasHojeComComparacao } = await import("../vendas");
    const result = await getVendasHojeComComparacao(baseFilters, 14, "2026-11-25");

    // Líquido: 50-5=45 unidades, 2500-250=2250 receita. SEM a correção, o código antigo
    // devolvia o bruto (50 / 2500) — essa asserção falha no código antigo (git stash) e passa
    // no novo.
    expect(result.hojeUnidades).toBe(45);
    expect(result.hojeReceita).toBe(2250);

    // Média diária da comparação também líquida: (560-140)/14 = 30 un, (28000-1400)/14 = 1900.
    expect(result.mediaDiariaUnidades).toBe(30);
    expect(result.mediaDiariaReceita).toBe(1900);

    // Variação calculada sobre os valores já líquidos dos dois lados.
    expect(result.variacaoUnidadesPct).toBe(50); // (45/30 - 1) * 100
    expect(result.variacaoReceitaPct).toBeCloseTo(18.42105263, 5); // (2250/1900 - 1) * 100

    expect(returnAggregate).toHaveBeenCalledTimes(2);
  });

  it("sem nenhuma devolução, líquido = bruto (sem regressão)", async () => {
    saleAggregate
      .mockResolvedValueOnce({ _sum: { quantidade: 20, valorTotalLiquido: 1000 } })
      .mockResolvedValueOnce({ _sum: { quantidade: 280, valorTotalLiquido: 14000 } });
    returnAggregate
      .mockResolvedValueOnce({ _sum: { quantidade: 0, valorTotal: 0 } })
      .mockResolvedValueOnce({ _sum: { quantidade: 0, valorTotal: 0 } });

    const { getVendasHojeComComparacao } = await import("../vendas");
    const result = await getVendasHojeComComparacao(baseFilters, 14, "2026-11-25");

    expect(result.hojeUnidades).toBe(20);
    expect(result.hojeReceita).toBe(1000);
  });
});

describe("getMaisVendidosSemana — líquido de devolução por produto", () => {
  it("desconta devolução do produto antes de ordenar o ranking", async () => {
    saleGroupBy.mockResolvedValueOnce([
      { produto: "Camiseta A", _sum: { quantidade: 20, valorTotalLiquido: 1000 } },
      { produto: "Camiseta B", _sum: { quantidade: 10, valorTotalLiquido: 600 } },
    ]);
    returnGroupBy.mockResolvedValueOnce([
      { produto: "Camiseta A", _sum: { quantidade: 5, valorTotal: 250 } },
    ]);

    const { getMaisVendidosSemana } = await import("../vendas");
    const result = await getMaisVendidosSemana(baseFilters, 10, "2026-11-25");

    const a = result.find((r) => r.produto === "Camiseta A")!;
    const b = result.find((r) => r.produto === "Camiseta B")!;

    // Líquido: A = 20-5=15 un / 1000-250=750; B sem devolução = 10 un / 600. SEM a correção, A
    // ficava com 20 unidades (bruto) — essa asserção falha no código antigo e passa no novo.
    expect(a.unidades).toBe(15);
    expect(a.receita).toBe(750);
    expect(b.unidades).toBe(10);
    expect(b.receita).toBe(600);
  });

  it("produto sem nenhuma devolução não é afetado (sem regressão)", async () => {
    saleGroupBy.mockResolvedValueOnce([
      { produto: "Short C", _sum: { quantidade: 8, valorTotalLiquido: 400 } },
    ]);
    returnGroupBy.mockResolvedValueOnce([]);

    const { getMaisVendidosSemana } = await import("../vendas");
    const result = await getMaisVendidosSemana(baseFilters, 10, "2026-11-25");

    expect(result).toEqual([{ produto: "Short C", unidades: 8, receita: 400 }]);
  });
});
