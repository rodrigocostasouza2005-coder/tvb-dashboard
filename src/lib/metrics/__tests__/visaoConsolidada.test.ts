import { describe, it, expect, vi, beforeEach } from "vitest";
import { PossibilidadeReposicao, StatusComercialProduto, TipoCompraProduto } from "@prisma/client";

const classificacaoFindMany = vi.fn();
const stockSnapshotGroupBy = vi.fn();
const saleGroupBy = vi.fn();
const productionOrderGroupBy = vi.fn();
const coberturaMetaFindMany = vi.fn();
const mapaComprasConfigFindUnique = vi.fn();
const saleFindMany = vi.fn();
const stockSnapshotFindMany = vi.fn();
// Devoluções (venda líquida = vendas − devoluções, adicionado em 2026-10-29). Neste cenário não há
// devolução nenhuma, então os números esperados abaixo não mudam.
const returnGroupBy = vi.fn().mockResolvedValue([]);
const returnFindMany = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    classificacaoProduto: { findMany: (...a: unknown[]) => classificacaoFindMany(...a) },
    stockSnapshot: {
      groupBy: (...a: unknown[]) => stockSnapshotGroupBy(...a),
      findMany: (...a: unknown[]) => stockSnapshotFindMany(...a),
    },
    sale: {
      groupBy: (...a: unknown[]) => saleGroupBy(...a),
      findMany: (...a: unknown[]) => saleFindMany(...a),
    },
    return: {
      groupBy: (...a: unknown[]) => returnGroupBy(...a),
      findMany: (...a: unknown[]) => returnFindMany(...a),
    },
    productionOrder: { groupBy: (...a: unknown[]) => productionOrderGroupBy(...a) },
    coberturaMeta: { findMany: (...a: unknown[]) => coberturaMetaFindMany(...a) },
    mapaComprasConfig: { findUnique: (...a: unknown[]) => mapaComprasConfigFindUnique(...a) },
  },
}));

// Cenário: 1 produto Best Seller (Camisetas, estoque zerado, vende bem -> risco de ruptura) e 1
// produto Drop (Bermudas, estoque baixo em relação à previsão até o fim da janela -> também risco
// de ruptura). Orçamento planejado só dá pra UM dos dois -> testa priorização (seção 7) e o
// rollup por grupo (seção 6) ao mesmo tempo.
describe("getVisaoConsolidadaCompras", () => {
  beforeEach(() => {
    classificacaoFindMany.mockReset();
    stockSnapshotGroupBy.mockReset();
    saleGroupBy.mockReset();
    productionOrderGroupBy.mockReset();
    coberturaMetaFindMany.mockReset();
    mapaComprasConfigFindUnique.mockReset();
    saleFindMany.mockReset();
    stockSnapshotFindMany.mockReset();

    classificacaoFindMany.mockImplementation((args: { where?: { tipoCompra?: TipoCompraProduto }; select?: unknown }) => {
      if (args.select) return Promise.resolve([]); // fila de revisão: nenhum produto classificado pendente neste teste
      if (args.where?.tipoCompra === TipoCompraProduto.BEST_SELLER) {
        return Promise.resolve([
          {
            cod: "BS-1",
            produto: "Camiseta Azul",
            grupo: "Camisetas",
            colecao: null,
            tipoCompra: TipoCompraProduto.BEST_SELLER,
            statusComercial: StatusComercialProduto.ATIVO,
            possibilidadeReposicao: PossibilidadeReposicao.SIM,
            dataLancamento: null,
            dataEncerramentoPrevista: null,
            orcamentoDrop: null,
          },
        ]);
      }
      if (args.where?.tipoCompra === TipoCompraProduto.DROP) {
        return Promise.resolve([
          {
            cod: "DROP-1",
            produto: "Bermuda Drop Verão",
            grupo: "Bermudas",
            colecao: "Drop Verão 26",
            tipoCompra: TipoCompraProduto.DROP,
            statusComercial: StatusComercialProduto.ATIVO,
            possibilidadeReposicao: PossibilidadeReposicao.SIM,
            dataLancamento: new Date(Date.now() - 20 * 86_400_000),
            dataEncerramentoPrevista: new Date(Date.now() + 10 * 86_400_000),
            orcamentoDrop: null,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    saleFindMany.mockResolvedValue([]);
    stockSnapshotFindMany.mockResolvedValue([]);

    // sale.groupBy: 3 formatos diferentes usados pelo código (vendas recentes com _sum+saleDate
    // range, primeira venda com _min, vendas acumuladas do Drop com _sum sem range de data).
    saleGroupBy.mockImplementation((args: { where?: { saleDate?: unknown; cod?: { in: string[] } }; _sum?: unknown; _min?: unknown }) => {
      const cods: string[] = args.where?.cod?.in ?? [];
      if (args._min) {
        // primeira venda -> 60 dias atrás pra todo mundo (histórico suficiente)
        return Promise.resolve(cods.map((cod) => ({ cod, _min: { saleDate: new Date(Date.now() - 60 * 86_400_000) } })));
      }
      if (args.where?.saleDate) {
        // vendas recentes (janela de 56 dias) -> BS-1 vende 2/dia (112 em 56 dias); DROP-1 vende 1/dia
        return Promise.resolve(
          cods.map((cod) => ({ cod, _sum: { quantidade: cod === "BS-1" ? 112 : 56 } }))
        );
      }
      // vendas acumuladas (Drop, sem range de data)
      return Promise.resolve(cods.map((cod) => ({ cod, _sum: { quantidade: cod === "DROP-1" ? 200 : 0 } })));
    });

    productionOrderGroupBy.mockResolvedValue([]); // sem pedido em aberto

    // estoque: BS-1 zerado (risco de ruptura); DROP-1 com 5 un (previsão até o fim da janela é maior)
    stockSnapshotGroupBy.mockImplementation((args: { where?: { cod?: { in: string[] }; valorCusto?: unknown }; _avg?: unknown }) => {
      const cods: string[] = args.where?.cod?.in ?? [];
      if (args._avg) {
        // custo unitário médio -> BS-1 custa 50, DROP-1 custa 80
        return Promise.resolve(cods.map((cod) => ({ cod, _avg: { valorCusto: cod === "BS-1" ? 50 : 80 } })));
      }
      return Promise.resolve(cods.map((cod) => ({ cod, _sum: { quantidadeDisponivel: cod === "BS-1" ? 0 : 5 } })));
    });

    coberturaMetaFindMany.mockResolvedValue([]); // sem meta cadastrada -> horizonte padrão
    // Orçamento planejado baixo (R$ 1.000) -> não cobre os dois ao mesmo tempo.
    mapaComprasConfigFindUnique.mockResolvedValue({ id: "global", crescimentoPct: 0, orcamentoTotalPlanejado: 1000 });
  });

  it("agrega por grupo separando Best Seller e Drop, com indicador e participação na verba", async () => {
    const { getVisaoConsolidadaCompras } = await import("../compras-inteligencia");
    const visao = await getVisaoConsolidadaCompras({});

    const camisetas = visao.porGrupo.find((g) => g.grupo === "Camisetas")!;
    const bermudas = visao.porGrupo.find((g) => g.grupo === "Bermudas")!;

    expect(camisetas.bestSeller.quantidadeSugerida).toBeGreaterThan(0);
    expect(camisetas.drop.quantidadeSugerida).toBe(0);
    expect(bermudas.drop.estoqueAtual).toBe(5);
    expect(bermudas.bestSeller.quantidadeSugerida).toBe(0);

    // soma dos valores por grupo bate com o total consolidado
    const somaGrupos = visao.porGrupo.reduce((s, g) => s + g.valorEstimadoTotal, 0);
    expect(Math.round(somaGrupos)).toBe(Math.round(visao.verbaSugeridaTotal));

    // participação em % soma ~100 entre os grupos (quando há verba sugerida)
    const somaParticipacao = visao.porGrupo.reduce((s, g) => s + (g.participacaoVerbaSugeridaPct ?? 0), 0);
    expect(Math.round(somaParticipacao)).toBe(100);
  });

  it("orçamento insuficiente para os dois -> prioriza em vez de cortar proporcionalmente, e expõe os fatores", async () => {
    const { getVisaoConsolidadaCompras } = await import("../compras-inteligencia");
    const visao = await getVisaoConsolidadaCompras({});

    expect(visao.itensPriorizados.length).toBe(2);
    const atendidos = visao.itensPriorizados.filter((i) => i.atendido);
    const naoAtendidos = visao.itensPriorizados.filter((i) => !i.atendido);
    // ambos têm risco de ruptura (tier 0) -> critério de desempate é impacto comercial; só um
    // cabe no orçamento de 1000, o outro fica de fora com motivo explícito.
    expect(atendidos.length).toBeGreaterThanOrEqual(1);
    expect(naoAtendidos.length).toBeGreaterThanOrEqual(1);
    for (const item of visao.itensPriorizados) {
      expect(item.fatoresPrioridade.length).toBeGreaterThan(0);
    }
  });

  it("horizonteDiasOverride (simulação) muda a demanda projetada sem precisar persistir nada", async () => {
    const { getVisaoConsolidadaCompras } = await import("../compras-inteligencia");
    const curto = await getVisaoConsolidadaCompras({ horizonteDiasOverride: 10 });
    classificacaoFindMany.mockClear();
    coberturaMetaFindMany.mockClear();
    // precisa re-chamar os mocks de novo (beforeEach só roda 1x por teste, não entre os 2 awaits)
    const longo = await getVisaoConsolidadaCompras({ horizonteDiasOverride: 90 });

    const bsAtivoCurto = curto.porGrupo.find((g) => g.grupo === "Camisetas")!;
    const bsAtivoLongo = longo.porGrupo.find((g) => g.grupo === "Camisetas")!;
    expect(bsAtivoLongo.bestSeller.demandaPrevista).toBeGreaterThan(bsAtivoCurto.bestSeller.demandaPrevista);
  });

  it("produto na fila de revisão não entra em nenhum grupo nem na priorização", async () => {
    stockSnapshotFindMany.mockResolvedValue([{ cod: "NOVO-1", produto: "Produto Novo", grupo: "Camisetas", colecao: null }]);
    const { getVisaoConsolidadaCompras } = await import("../compras-inteligencia");
    const visao = await getVisaoConsolidadaCompras({});
    expect(visao.produtosFilaRevisaoCount).toBe(1);
    expect(visao.itensPriorizados.some((i) => i.id.includes("NOVO-1"))).toBe(false);
  });
});
