import { describe, it, expect, vi, beforeEach } from "vitest";

const saleGroupBy = vi.fn();
const returnGroupBy = vi.fn();
const stockSnapshotFindMany = vi.fn();
const saleAggregate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sale: {
      groupBy: (...a: unknown[]) => saleGroupBy(...a),
      aggregate: (...a: unknown[]) => saleAggregate(...a),
    },
    return: { groupBy: (...a: unknown[]) => returnGroupBy(...a) },
    stockSnapshot: { findMany: (...a: unknown[]) => stockSnapshotFindMany(...a) },
  },
}));

const FROM = new Date("2026-10-01T00:00:00.000Z");
const TO = new Date("2026-10-31T23:59:59.999Z");
// Período anterior esperado: mesma duração, imediatamente antes (sem sobrepor).
const DURACAO = TO.getTime() - FROM.getTime();
const PREV_TO = new Date(FROM.getTime() - 1);
const PREV_FROM = new Date(PREV_TO.getTime() - DURACAO);

const baseFilters = { from: FROM, to: TO, storeIds: undefined, marcas: undefined, tabelasPreco: undefined, grupoIn: undefined, tamanhoIn: undefined, colecaoIn: undefined };

function ehPeriodoAtual(where: { saleDate?: { gte?: Date } } | undefined) {
  const gte = where?.saleDate?.gte;
  return !!gte && gte.getTime() === FROM.getTime();
}

// Monta os mocks de venda/devolução por grupo pros 2 períodos. "atual"/"anterior": Map<grupo, {qtd, receita}>.
function configurarVendas(atual: Record<string, { qtd: number; receita: number }>, anterior: Record<string, { qtd: number; receita: number }> = {}) {
  saleGroupBy.mockImplementation((args: { by: string[]; where?: { saleDate?: { gte?: Date } } }) => {
    const dados = ehPeriodoAtual(args.where) ? atual : anterior;
    if (args.by.includes("cod")) {
      // getCmvPorGrupo: 1 "sku" fictício por grupo, mesmo código em todos pra simplificar custo.
      return Promise.resolve(
        Object.entries(dados).map(([grupo, v]) => ({ cod: `COD-${grupo}`, grupo, _sum: { quantidade: v.qtd } }))
      );
    }
    return Promise.resolve(
      Object.entries(dados).map(([grupo, v]) => ({ grupo, _sum: { quantidade: v.qtd, valorTotalLiquido: v.receita } }))
    );
  });
}

describe("getVariacaoReceitaLiquidaPorGrupo", () => {
  beforeEach(() => {
    saleGroupBy.mockReset();
    returnGroupBy.mockReset();
    stockSnapshotFindMany.mockReset();
    saleAggregate.mockReset();
    returnGroupBy.mockResolvedValue([]); // sem devolução por padrão
    stockSnapshotFindMany.mockResolvedValue([]); // sem custo cadastrado -> margem null, não quebra
    saleAggregate.mockResolvedValue({ _min: { saleDate: new Date("2024-01-01") } }); // histórico "infinito" por padrão
    vi.resetModules();
  });

  it("crescimento positivo: variação % e cor corretas", async () => {
    configurarVendas({ Camisetas: { qtd: 10, receita: 2000 } }, { Camisetas: { qtd: 10, receita: 1000 } });
    const { getVariacaoReceitaLiquidaPorGrupo } = await import("../vendas");
    const [row] = await getVariacaoReceitaLiquidaPorGrupo(baseFilters);
    expect(row.status).toBe("normal");
    expect(row.variacaoPercentual).toBe(100);
    expect(row.variacaoAbsoluta).toBe(1000);
  });

  it("queda: variação % negativa", async () => {
    configurarVendas({ Shorts: { qtd: 5, receita: 500 } }, { Shorts: { qtd: 10, receita: 1000 } });
    const { getVariacaoReceitaLiquidaPorGrupo } = await import("../vendas");
    const [row] = await getVariacaoReceitaLiquidaPorGrupo(baseFilters);
    expect(row.variacaoPercentual).toBe(-50);
  });

  it("estabilidade: receita igual nos dois períodos -> variação 0%", async () => {
    configurarVendas({ Bermudas: { qtd: 8, receita: 800 } }, { Bermudas: { qtd: 8, receita: 800 } });
    const { getVariacaoReceitaLiquidaPorGrupo } = await import("../vendas");
    const [row] = await getVariacaoReceitaLiquidaPorGrupo(baseFilters);
    expect(row.variacaoPercentual).toBe(0);
    expect(row.status).toBe("normal");
  });

  it("receita anterior zero (grupo novo) -> status 'novo', sem percentual inventado", async () => {
    configurarVendas({ "Linha Nova": { qtd: 3, receita: 300 } }, {});
    const { getVariacaoReceitaLiquidaPorGrupo } = await import("../vendas");
    const [row] = await getVariacaoReceitaLiquidaPorGrupo(baseFilters);
    expect(row.status).toBe("novo");
    expect(row.variacaoPercentual).toBeNull();
  });

  it("sem base histórica (período anterior cai antes da 1ª venda da base) -> 'sem_base' pra todos, mesmo com receita > 0 nos dois períodos", async () => {
    configurarVendas({ Camisetas: { qtd: 10, receita: 2000 } }, { Camisetas: { qtd: 10, receita: 1000 } });
    // 1ª venda da empresa é DEPOIS do início do período anterior -> não dá pra confiar na comparação.
    saleAggregate.mockResolvedValue({ _min: { saleDate: new Date(PREV_FROM.getTime() + 86400000) } });
    const { getVariacaoReceitaLiquidaPorGrupo } = await import("../vendas");
    const [row] = await getVariacaoReceitaLiquidaPorGrupo(baseFilters);
    expect(row.status).toBe("sem_base");
    expect(row.variacaoPercentual).toBeNull();
  });

  it("ordenação: maior crescimento primeiro, maior queda por último, 'novo' no topo e 'sem_base' no fim", async () => {
    configurarVendas(
      { Subiu: { qtd: 10, receita: 150 }, Caiu: { qtd: 10, receita: 50 }, NovoGrupo: { qtd: 5, receita: 100 } },
      { Subiu: { qtd: 10, receita: 100 }, Caiu: { qtd: 10, receita: 100 } }
    );
    const { getVariacaoReceitaLiquidaPorGrupo } = await import("../vendas");
    const rows = await getVariacaoReceitaLiquidaPorGrupo(baseFilters);
    expect(rows.map((r) => r.grupo)).toEqual(["NovoGrupo", "Subiu", "Caiu"]);
  });

  it("devolução entra no cálculo de receita líquida (não é a fórmula bruta)", async () => {
    saleGroupBy.mockImplementation((args: { by: string[]; where?: { saleDate?: { gte?: Date } } }) => {
      const atualPeriodo = ehPeriodoAtual(args.where);
      if (args.by.includes("cod")) return Promise.resolve([]);
      if (atualPeriodo) return Promise.resolve([{ grupo: "Vestidos", _sum: { quantidade: 10, valorTotalLiquido: 1000 } }]);
      return Promise.resolve([{ grupo: "Vestidos", _sum: { quantidade: 10, valorTotalLiquido: 1000 } }]);
    });
    returnGroupBy.mockImplementation((args: { where?: { returnDate?: { gte?: Date } } }) => {
      // devolução só no período ATUAL (identificado pelo range de returnDate)
      const gte = args.where?.returnDate?.gte;
      const ehAtual = gte && gte.getTime() === FROM.getTime();
      return Promise.resolve(ehAtual ? [{ grupo: "Vestidos", _sum: { quantidade: 2, valorTotal: 200 } }] : []);
    });

    const { getVariacaoReceitaLiquidaPorGrupo } = await import("../vendas");
    const [row] = await getVariacaoReceitaLiquidaPorGrupo(baseFilters);

    // Atual: 1000 bruto - 200 devolvido = 800 líquido. Anterior: 1000 líquido (sem devolução).
    expect(row.receitaAtual).toBe(800);
    expect(row.receitaAnterior).toBe(1000);
  });

  it("respeita o filtro de loja (storeIds) — passa adiante pras consultas de ambos os períodos", async () => {
    configurarVendas({ Camisetas: { qtd: 1, receita: 100 } }, { Camisetas: { qtd: 1, receita: 100 } });
    const { getVariacaoReceitaLiquidaPorGrupo } = await import("../vendas");
    await getVariacaoReceitaLiquidaPorGrupo({ ...baseFilters, storeIds: ["store-leblon"] });

    const algumaChamadaComLoja = saleGroupBy.mock.calls.some(
      (c) => JSON.stringify((c[0] as { where?: { storeId?: unknown } }).where?.storeId) === JSON.stringify({ in: ["store-leblon"] })
    );
    expect(algumaChamadaComLoja).toBe(true);
  });

  it("grupo sem classificação (string vazia) aparece como '—', não é descartado silenciosamente", async () => {
    saleGroupBy.mockImplementation((args: { by: string[]; where?: { saleDate?: { gte?: Date } } }) => {
      if (args.by.includes("cod")) return Promise.resolve([]);
      if (ehPeriodoAtual(args.where)) return Promise.resolve([{ grupo: "", _sum: { quantidade: 1, valorTotalLiquido: 50 } }]);
      return Promise.resolve([]);
    });
    const { getVariacaoReceitaLiquidaPorGrupo } = await import("../vendas");
    const rows = await getVariacaoReceitaLiquidaPorGrupo(baseFilters);
    expect(rows).toHaveLength(1);
    expect(rows[0].grupo).toBe("—");
  });
});
