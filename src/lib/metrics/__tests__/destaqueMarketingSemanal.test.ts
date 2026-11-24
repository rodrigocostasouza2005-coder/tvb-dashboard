import { describe, it, expect, vi, beforeEach } from "vitest";

const getProdutosPlanejamento = vi.fn();
const getSellthroughColecaoDetalhe = vi.fn();
const stockSnapshotFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stockSnapshot: { findMany: (...a: unknown[]) => stockSnapshotFindMany(...a) },
  },
}));

vi.mock("../planejamento-estoque", () => ({
  getProdutosPlanejamento: (...a: unknown[]) => getProdutosPlanejamento(...a),
}));

vi.mock("../sellthrough", () => ({
  getSellthroughColecaoDetalhe: (...a: unknown[]) => getSellthroughColecaoDetalhe(...a),
}));

function baseProduto(overrides: Record<string, unknown> = {}) {
  return {
    produto: "Camisa Polo",
    grupo: "Polos",
    classificacao: "NAO_CLASSIFICADO",
    cods: ["COD-1"],
    estoqueTotal: 10,
    estoqueCD: 0,
    estoqueLojas: 10,
    vendasDias30: 5,
    vendasDias60: 10,
    vendasDias90: 15,
    velocidadeDiaria: 0.17,
    coberturaDias: 60,
    diasHistoricoDisponivel: 200,
    confiavel: true,
    situacao: "equilibrado",
    tendencia: "estavel",
    demandaPossivelmenteMascarada: false,
    quantidadeEmTransito: 0,
    transitoConfiavel: false,
    necessidadeReposicao: false,
    ...overrides,
  };
}

function baseSellthrough(overrides: Record<string, unknown> = {}) {
  return {
    grupo: "Polos",
    produto: "Camisa Polo",
    produzido: 100,
    vendido: 50,
    devolvido: 0,
    brinde: 0,
    saida: 50,
    revenue: 1000,
    sellThroughRate: 50,
    ...overrides,
  };
}

beforeEach(() => {
  getProdutosPlanejamento.mockReset();
  getSellthroughColecaoDetalhe.mockReset().mockResolvedValue([]);
  stockSnapshotFindMany.mockReset().mockResolvedValue([]);
  // getDestaqueMarketingSemanal é cacheado (cacheAsync/core.ts, mesmo padrão de
  // montarComparacao em distribuicao-estoque.ts) — sem resetModules, chamadas com o MESMO filtro
  // ({} default) em testes diferentes reaproveitariam o resultado cacheado do teste anterior.
  vi.resetModules();
});

describe("avaliarCriteriosDestaque (núcleo puro)", () => {
  it("lançamento recente: bate só esse critério", async () => {
    const { avaliarCriteriosDestaque } = await import("../destaque-marketing-semanal");
    const { criterios, justificativas } = avaliarCriteriosDestaque({
      situacao: "lancamento_recente",
      tendencia: "sem_dado",
      isBestSeller: false,
      sellThroughRate: null,
      vendidoParaSellThrough: 0,
      coberturaDias: null,
      estoqueTotal: 40,
      vendasDias30: 0,
      vendasDias60: 0,
    });
    expect(criterios).toEqual(["lancamento_recente"]);
    expect(justificativas[0]).toContain("40 un.");
  });

  it("best seller em alta: precisa de isBestSeller E tendencia crescimento, nenhum isolado basta", async () => {
    const { avaliarCriteriosDestaque } = await import("../destaque-marketing-semanal");

    const soBestSeller = avaliarCriteriosDestaque({
      situacao: "equilibrado",
      tendencia: "estavel",
      isBestSeller: true,
      sellThroughRate: null,
      vendidoParaSellThrough: 0,
      coberturaDias: 30,
      estoqueTotal: 10,
      vendasDias30: 5,
      vendasDias60: 5,
    });
    expect(soBestSeller.criterios).toEqual([]);

    const soCrescimento = avaliarCriteriosDestaque({
      situacao: "equilibrado",
      tendencia: "crescimento",
      isBestSeller: false,
      sellThroughRate: null,
      vendidoParaSellThrough: 0,
      coberturaDias: 30,
      estoqueTotal: 10,
      vendasDias30: 5,
      vendasDias60: 5,
    });
    expect(soCrescimento.criterios).toEqual([]);

    const ambos = avaliarCriteriosDestaque({
      situacao: "equilibrado",
      tendencia: "crescimento",
      isBestSeller: true,
      sellThroughRate: null,
      vendidoParaSellThrough: 0,
      coberturaDias: 30,
      estoqueTotal: 10,
      vendasDias30: 15,
      vendasDias60: 20,
    });
    expect(ambos.criterios).toEqual(["best_seller_em_alta"]);
    expect(ambos.justificativas[0]).toContain("15 un.");
    expect(ambos.justificativas[0]).toContain("5 un."); // anterior = 20 - 15
  });

  it("best seller em alta: período anterior zero tem justificativa honesta (não inventa um 'X% de crescimento')", async () => {
    const { avaliarCriteriosDestaque } = await import("../destaque-marketing-semanal");
    const { justificativas } = avaliarCriteriosDestaque({
      situacao: "equilibrado",
      tendencia: "crescimento",
      isBestSeller: true,
      sellThroughRate: null,
      vendidoParaSellThrough: 0,
      coberturaDias: 30,
      estoqueTotal: 10,
      vendasDias30: 8,
      vendasDias60: 8, // anterior = 0
    });
    expect(justificativas[0]).toContain("sem nenhuma venda no período equivalente anterior");
  });

  it("baixo sell-through: só conta com venda histórica real (guard do bug 0%=sem dado)", async () => {
    const { avaliarCriteriosDestaque } = await import("../destaque-marketing-semanal");

    const semVendaHistorica = avaliarCriteriosDestaque({
      situacao: "equilibrado",
      tendencia: "sem_dado",
      isBestSeller: false,
      sellThroughRate: 0, // formula daria 0% mesmo sem histórico de venda
      vendidoParaSellThrough: 0,
      coberturaDias: null,
      estoqueTotal: 10,
      vendasDias30: 0,
      vendasDias60: 0,
    });
    expect(semVendaHistorica.criterios).toEqual([]);

    const comVendaBaixa = avaliarCriteriosDestaque({
      situacao: "equilibrado",
      tendencia: "sem_dado",
      isBestSeller: false,
      sellThroughRate: 12,
      vendidoParaSellThrough: 30,
      coberturaDias: null,
      estoqueTotal: 10,
      vendasDias30: 1,
      vendasDias60: 2,
    });
    expect(comVendaBaixa.criterios).toEqual(["baixo_sell_through"]);
    expect(comVendaBaixa.justificativas[0]).toContain("12.0%");
  });

  it("baixo sell-through: 30% exatos (limiar) NÃO bate — só abaixo do limiar", async () => {
    const { avaliarCriteriosDestaque } = await import("../destaque-marketing-semanal");
    const { criterios } = avaliarCriteriosDestaque({
      situacao: "equilibrado",
      tendencia: "sem_dado",
      isBestSeller: false,
      sellThroughRate: 30,
      vendidoParaSellThrough: 30,
      coberturaDias: null,
      estoqueTotal: 10,
      vendasDias30: 3,
      vendasDias60: 6,
    });
    expect(criterios).toEqual([]);
  });

  it("excesso de estoque: justificativa expõe quantas vezes o limiar de 60 dias", async () => {
    const { avaliarCriteriosDestaque } = await import("../destaque-marketing-semanal");
    const { criterios, justificativas } = avaliarCriteriosDestaque({
      situacao: "cobertura_excessiva",
      tendencia: "sem_dado",
      isBestSeller: false,
      sellThroughRate: null,
      vendidoParaSellThrough: 0,
      coberturaDias: 180,
      estoqueTotal: 300,
      vendasDias30: 10,
      vendasDias60: 20,
    });
    expect(criterios).toEqual(["excesso_estoque"]);
    expect(justificativas[0]).toContain("180 dia(s)");
    expect(justificativas[0]).toContain("3x o limiar");
  });

  it("combinação: produto que bate em 2+ critérios ao mesmo tempo (sinal mais forte)", async () => {
    const { avaliarCriteriosDestaque } = await import("../destaque-marketing-semanal");
    const { criterios, justificativas } = avaliarCriteriosDestaque({
      situacao: "cobertura_excessiva",
      tendencia: "sem_dado",
      isBestSeller: false,
      sellThroughRate: 10,
      vendidoParaSellThrough: 40,
      coberturaDias: 120,
      estoqueTotal: 300,
      vendasDias30: 4,
      vendasDias60: 8,
    });
    expect(criterios).toEqual(["baixo_sell_through", "excesso_estoque"]);
    expect(justificativas).toHaveLength(2);
  });

  it("nenhum critério bate: lista vazia (produto 'normal', sem destaque)", async () => {
    const { avaliarCriteriosDestaque } = await import("../destaque-marketing-semanal");
    const { criterios } = avaliarCriteriosDestaque({
      situacao: "equilibrado",
      tendencia: "estavel",
      isBestSeller: false,
      sellThroughRate: 60,
      vendidoParaSellThrough: 100,
      coberturaDias: 45,
      estoqueTotal: 50,
      vendasDias30: 10,
      vendasDias60: 20,
    });
    expect(criterios).toEqual([]);
  });
});

describe("getDestaqueMarketingSemanal (camada de dados)", () => {
  it("produto sem nenhum critério não aparece na lista", async () => {
    getProdutosPlanejamento.mockResolvedValue([baseProduto()]);
    const { getDestaqueMarketingSemanal } = await import("../destaque-marketing-semanal");
    const result = await getDestaqueMarketingSemanal();
    expect(result).toEqual([]);
  });

  it("junta situacao (lancamento_recente) + grupo/cods corretos", async () => {
    getProdutosPlanejamento.mockResolvedValue([
      baseProduto({ produto: "Vestido Novo", situacao: "lancamento_recente", cods: ["COD-9", "COD-10"] }),
    ]);
    const { getDestaqueMarketingSemanal } = await import("../destaque-marketing-semanal");
    const result = await getDestaqueMarketingSemanal();
    expect(result).toHaveLength(1);
    expect(result[0].produto).toBe("Vestido Novo");
    expect(result[0].cods).toEqual(["COD-9", "COD-10"]);
    expect(result[0].criterios).toEqual(["lancamento_recente"]);
    expect(result[0].sinalForte).toBe(false);
  });

  it("cruza best seller (StockSnapshot.colecao) + tendencia de crescimento pelo PRODUTO", async () => {
    getProdutosPlanejamento.mockResolvedValue([
      baseProduto({ produto: "Bermuda X", tendencia: "crescimento", vendasDias30: 20, vendasDias60: 30 }),
      baseProduto({ produto: "Bermuda Y", tendencia: "crescimento", vendasDias30: 20, vendasDias60: 30 }),
    ]);
    stockSnapshotFindMany.mockResolvedValue([{ produto: "Bermuda X" }]);
    const { getDestaqueMarketingSemanal } = await import("../destaque-marketing-semanal");
    const result = await getDestaqueMarketingSemanal();
    expect(result.map((r) => r.produto)).toEqual(["Bermuda X"]);
    expect(result[0].metricas.isBestSeller).toBe(true);
  });

  it("cruza sell-through por grupo+produto (não mistura produtos de grupos diferentes com o mesmo nome)", async () => {
    getProdutosPlanejamento.mockResolvedValue([
      baseProduto({ produto: "Classico", grupo: "Camisetas" }),
      baseProduto({ produto: "Classico", grupo: "Shorts" }),
    ]);
    getSellthroughColecaoDetalhe.mockResolvedValue([
      baseSellthrough({ produto: "Classico", grupo: "Camisetas", sellThroughRate: 10, vendido: 40 }),
      baseSellthrough({ produto: "Classico", grupo: "Shorts", sellThroughRate: 80, vendido: 40 }),
    ]);
    const { getDestaqueMarketingSemanal } = await import("../destaque-marketing-semanal");
    const result = await getDestaqueMarketingSemanal();
    expect(result).toHaveLength(1);
    expect(result[0].grupo).toBe("Camisetas");
    expect(result[0].criterios).toEqual(["baixo_sell_through"]);
  });

  it("produto que bate em 2 critérios ao mesmo tempo (best seller em alta + excesso) vem com sinalForte=true e ordenado primeiro", async () => {
    getProdutosPlanejamento.mockResolvedValue([
      baseProduto({ produto: "Normal", situacao: "equilibrado", tendencia: "estavel" }),
      baseProduto({
        produto: "Campeão",
        situacao: "cobertura_excessiva",
        coberturaDias: 180,
        tendencia: "crescimento",
        vendasDias30: 50,
        vendasDias60: 70,
      }),
    ]);
    stockSnapshotFindMany.mockResolvedValue([{ produto: "Campeão" }]);
    const { getDestaqueMarketingSemanal } = await import("../destaque-marketing-semanal");
    const result = await getDestaqueMarketingSemanal();
    expect(result).toHaveLength(1); // "Normal" não bate em nenhum critério
    expect(result[0].produto).toBe("Campeão");
    expect(result[0].criterios.sort()).toEqual(["best_seller_em_alta", "excesso_estoque"].sort());
    expect(result[0].sinalForte).toBe(true);
    expect(result[0].justificativas).toHaveLength(2);
  });

  it("ordena por número de critérios (desc) e depois por nome do produto", async () => {
    getProdutosPlanejamento.mockResolvedValue([
      baseProduto({ produto: "Zebra", situacao: "lancamento_recente" }),
      baseProduto({
        produto: "Abacaxi",
        situacao: "cobertura_excessiva",
        coberturaDias: 90,
        tendencia: "crescimento",
        vendasDias30: 10,
        vendasDias60: 15,
      }),
    ]);
    stockSnapshotFindMany.mockResolvedValue([{ produto: "Abacaxi" }]);
    const { getDestaqueMarketingSemanal } = await import("../destaque-marketing-semanal");
    const result = await getDestaqueMarketingSemanal();
    expect(result.map((r) => r.produto)).toEqual(["Abacaxi", "Zebra"]);
  });
});
