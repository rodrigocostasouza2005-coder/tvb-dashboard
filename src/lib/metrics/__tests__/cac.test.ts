import { describe, it, expect, vi, beforeEach } from "vitest";

const storeFindFirst = vi.fn();
const saleGroupBy = vi.fn();
const queryRaw = vi.fn();
const getInsightsPorConjunto = vi.fn();
const getGastoDiarioConta = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findFirst: (...a: unknown[]) => storeFindFirst(...a) },
    sale: { groupBy: (...a: unknown[]) => saleGroupBy(...a) },
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
  },
}));

vi.mock("@/lib/connectors/meta-ads", () => ({
  getInsightsPorConjunto: (...a: unknown[]) => getInsightsPorConjunto(...a),
  getGastoDiarioConta: (...a: unknown[]) => getGastoDiarioConta(...a),
}));

const CD_STORE_ID = "store-cd-123";
const FROM = new Date("2026-11-01T00:00:00-03:00");
const TO = new Date("2026-11-30T23:59:59-03:00");

function mockInsightsGasto(total: number) {
  getInsightsPorConjunto.mockResolvedValue(
    new Map([
      ["Conjunto A", { gasto: total / 2, impressoes: 0, alcance: 0, cliques: 0, ctrPct: 0, cpc: 0, cpm: 0, compras: 0, roas: null, custoPorCompra: null }],
      ["Conjunto B", { gasto: total / 2, impressoes: 0, alcance: 0, cliques: 0, ctrPct: 0, cpc: 0, cpm: 0, compras: 0, roas: null, custoPorCompra: null }],
    ])
  );
}

beforeEach(() => {
  storeFindFirst.mockReset();
  saleGroupBy.mockReset();
  queryRaw.mockReset();
  getInsightsPorConjunto.mockReset();
  getGastoDiarioConta.mockReset();
  storeFindFirst.mockResolvedValue({ id: CD_STORE_ID, code: "CD" });
});

describe("getEcommerceStoreId — resolução do Store de e-commerce", () => {
  it("resolve pelo code=CD, nunca por displayGroup", async () => {
    const { getEcommerceStoreId } = await import("../cac");
    const id = await getEcommerceStoreId();
    expect(id).toBe(CD_STORE_ID);
    expect(storeFindFirst).toHaveBeenCalledWith({ where: { code: "CD" } });
  });

  it("devolve null quando o Store CD não existe (sync nunca rodou)", async () => {
    storeFindFirst.mockResolvedValueOnce(null);
    const { getEcommerceStoreId } = await import("../cac");
    expect(await getEcommerceStoreId()).toBeNull();
  });
});

describe("getCacEcommerce — só e-commerce no denominador", () => {
  it("consulta Sale restrita ao storeId do Store CD (nunca ATACADO/loja física)", async () => {
    saleGroupBy.mockResolvedValueOnce([]); // nenhum comprador no período -> early return
    mockInsightsGasto(1000);

    const { getCacEcommerce } = await import("../cac");
    await getCacEcommerce(FROM, TO);

    const whereUsado = saleGroupBy.mock.calls[0][0].where;
    expect(whereUsado.storeId).toEqual({ in: [CD_STORE_ID] });
  });

  it("venda cancelada não conta como compra válida (reutiliza saleWhere -> status != Cancelada)", async () => {
    saleGroupBy.mockResolvedValueOnce([]);
    mockInsightsGasto(1000);

    const { getCacEcommerce } = await import("../cac");
    await getCacEcommerce(FROM, TO);

    const whereUsado = saleGroupBy.mock.calls[0][0].where;
    expect(whereUsado.status).toEqual({ not: "Cancelada" });
  });

  it("comprador cuja 1ª compra global cai dentro do período conta como novo, CAC = investimento/novos", async () => {
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "Ana Paula" }]);
    queryRaw
      .mockResolvedValueOnce([{ norm: "ANA PAULA", first: new Date("2026-11-10") }]) // Sale (1ª compra global)
      .mockResolvedValueOnce([]) // ClienteCadastro.primeiraCompraExterna
      .mockResolvedValueOnce([{ norm: "ANA PAULA", dapicId: 1 }]); // cadastro vinculado (1 só -> sem homônimo)
    mockInsightsGasto(1000);

    const { getCacEcommerce } = await import("../cac");
    const r = await getCacEcommerce(FROM, TO);

    expect(r.novosCompradores).toBe(1);
    expect(r.cac).toBe(1000);
  });

  it("histórico de compra em OUTRO canal (loja física/atacado) não gera falso novo — 1ª compra global anterior ao período -> recorrente", async () => {
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "Bruno Costa" }]);
    // getPrimeiraCompraGlobalPorCliente é chamada SEM storeIds (busca global) — mesmo que Bruno só
    // tenha comprado no site agora, a 1ª compra dele na empresa (ex: loja física) foi antes.
    queryRaw
      .mockResolvedValueOnce([{ norm: "BRUNO COSTA", first: new Date("2026-01-10") }])
      .mockResolvedValueOnce([]);
    mockInsightsGasto(1000);

    const { getCacEcommerce } = await import("../cac");
    const r = await getCacEcommerce(FROM, TO);

    expect(r.novosCompradores).toBe(0);
    expect(r.recorrentes).toBe(1);
    // CAC não pode ser computado com 0 novos -> null, nunca Infinity ou 0.
    expect(r.cac).toBeNull();
  });

  it("primeira compra global é buscada sem storeIds (nunca restrita só ao e-commerce)", async () => {
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "Carla Dias" }]);
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockInsightsGasto(1000);

    const { getCacEcommerce } = await import("../cac");
    await getCacEcommerce(FROM, TO);

    // 1ª chamada de $queryRaw é a busca de 1ª compra em Sale — não deve levar storeId=CD no SQL
    // (storeIds=undefined -> usa o branch de query global, sem o "AND storeId = ANY(...)").
    const primeiraChamadaSql = (queryRaw.mock.calls[0][0] as TemplateStringsArray).join("");
    expect(primeiraChamadaSql).not.toContain('"storeId" = ANY');
  });

  it("cliente 'novo' sem nenhum ClienteCadastro vinculável pelo nome é sinalizado (identidade nunca verificada)", async () => {
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "Sem Cadastro" }]);
    queryRaw
      .mockResolvedValueOnce([{ norm: "SEM CADASTRO", first: new Date("2026-11-05") }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]); // nenhum ClienteCadastro bate com esse nome
    mockInsightsGasto(1000);

    const { getCacEcommerce } = await import("../cac");
    const r = await getCacEcommerce(FROM, TO);

    expect(r.novosCompradores).toBe(1);
    expect(r.semCadastroVinculado).toBe(1);
    expect(r.confiavel).toBe(false);
  });

  it("homônimo real (2 dapicId distintos pro mesmo nome normalizado) é detectado e reportado", async () => {
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "Joao Silva" }]);
    queryRaw
      .mockResolvedValueOnce([{ norm: "JOAO SILVA", first: new Date("2026-11-05") }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { norm: "JOAO SILVA", dapicId: 10 },
        { norm: "JOAO SILVA", dapicId: 20 },
      ]);
    mockInsightsGasto(1000);

    const { getCacEcommerce } = await import("../cac");
    const r = await getCacEcommerce(FROM, TO);

    expect(r.homonimosDetectados).toBe(1);
    expect(r.confiavel).toBe(false);
    expect(r.motivoLimitacao).toContain("homônimo");
  });

  it("confiavel é sempre false, mesmo sem nenhum homônimo detectado no período (ausência de colisão não prova identidade)", async () => {
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "Ana Paula" }]);
    queryRaw
      .mockResolvedValueOnce([{ norm: "ANA PAULA", first: new Date("2026-11-10") }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ norm: "ANA PAULA", dapicId: 1 }]);
    mockInsightsGasto(1000);

    const { getCacEcommerce } = await import("../cac");
    const r = await getCacEcommerce(FROM, TO);

    expect(r.confiavel).toBe(false);
    expect(r.motivoLimitacao.length).toBeGreaterThan(0);
  });

  it("investimento indisponível (Meta Ads falhou) não quebra o cálculo — cac vira null e fica sinalizado", async () => {
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "Ana Paula" }]);
    queryRaw
      .mockResolvedValueOnce([{ norm: "ANA PAULA", first: new Date("2026-11-10") }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ norm: "ANA PAULA", dapicId: 1 }]);
    getInsightsPorConjunto.mockRejectedValue(new Error("META_AD_ACCOUNT_ID / META_ACCESS_TOKEN não configurados"));

    const { getCacEcommerce } = await import("../cac");
    const r = await getCacEcommerce(FROM, TO);

    expect(r.investimentoIndisponivel).toBe(true);
    expect(r.cac).toBeNull();
    expect(r.investimento).toBe(0);
  });

  it("Store CD inexistente devolve resultado seguro (sem storeId, não cai pra 'todas as lojas')", async () => {
    storeFindFirst.mockResolvedValueOnce(null);

    const { getCacEcommerce } = await import("../cac");
    const r = await getCacEcommerce(FROM, TO);

    expect(r.novosCompradores).toBe(0);
    expect(r.cac).toBeNull();
    expect(r.confiavel).toBe(false);
    expect(saleGroupBy).not.toHaveBeenCalled();
  });
});

describe("getCacPorCampanha — limitação documentada, não calcula número inventado", () => {
  it("devolve disponivel=false com o motivo da falta de atribuição", async () => {
    const { getCacPorCampanha } = await import("../cac");
    const r = getCacPorCampanha();
    expect(r.disponivel).toBe(false);
    expect(r.motivo.length).toBeGreaterThan(0);
  });
});

// getNovosClientesDiarioEcommerce — versão diária de getNovosCompradoresEcommerce (gráfico "CAC
// diário", missão 2026-11-07), usando Sale.clienteCadastroId (PR #65) em vez de nome cru.
describe("getNovosClientesDiarioEcommerce — novo/recorrente por dia via clienteCadastroId", () => {
  const FROM_DIA = new Date("2026-11-01T00:00:00-03:00");
  const TO_DIA = new Date("2026-11-02T23:59:59-03:00");

  it("comprador com clienteCadastroId cuja 1ª compra GLOBAL cai no mesmo dia conta como novo nesse dia", async () => {
    queryRaw
      .mockResolvedValueOnce([{ day: new Date("2026-11-01T00:00:00.000Z"), clienteCadastroId: "cc-1", clienteNome: "Ana Paula" }])
      .mockResolvedValueOnce([{ clienteCadastroId: "cc-1", first: new Date("2026-11-01T12:00:00-03:00") }])
      .mockResolvedValueOnce([]); // ClienteCadastro.primeiraCompraExterna

    const { getNovosClientesDiarioEcommerce } = await import("../cac");
    const result = await getNovosClientesDiarioEcommerce(CD_STORE_ID, FROM_DIA, TO_DIA);

    expect(result.get("2026-11-01")).toEqual({ novos: 1, recorrentes: 0, naoIdentificados: 0 });
  });

  it("1ª compra global ANTERIOR ao dia (ex: comprou antes em outra loja) conta como recorrente, nunca novo", async () => {
    queryRaw
      .mockResolvedValueOnce([{ day: new Date("2026-11-01T00:00:00.000Z"), clienteCadastroId: "cc-2", clienteNome: "Bruno Costa" }])
      .mockResolvedValueOnce([{ clienteCadastroId: "cc-2", first: new Date("2026-01-10T00:00:00-03:00") }])
      .mockResolvedValueOnce([]);

    const { getNovosClientesDiarioEcommerce } = await import("../cac");
    const result = await getNovosClientesDiarioEcommerce(CD_STORE_ID, FROM_DIA, TO_DIA);

    expect(result.get("2026-11-01")).toEqual({ novos: 0, recorrentes: 1, naoIdentificados: 0 });
  });

  it("venda SEM clienteCadastroId mas COM clienteNome cai no fallback por nome (pedido 2026-11-08: nunca mais 'não identificado' havendo qualquer identidade) — classifica novo/recorrente normalmente", async () => {
    queryRaw
      .mockResolvedValueOnce([{ day: new Date("2026-11-01T00:00:00.000Z"), clienteCadastroId: null, clienteNome: "Sem Vinculo" }])
      .mockResolvedValueOnce([{ norm: "SEM VINCULO", first: new Date("2026-11-01T10:00:00-03:00") }]) // primeiraPorNome -> cai no mesmo dia, é novo
      .mockResolvedValueOnce([]); // externaPorNome (ClienteCadastro.primeiraCompraExterna via nome)

    const { getNovosClientesDiarioEcommerce } = await import("../cac");
    const result = await getNovosClientesDiarioEcommerce(CD_STORE_ID, FROM_DIA, TO_DIA);

    expect(result.get("2026-11-01")).toEqual({ novos: 1, recorrentes: 0, naoIdentificados: 0 });
  });

  it("venda sem NENHUMA identidade (sem clienteCadastroId e sem clienteNome) continua sem classificação — único caso residual de naoIdentificados, mas nem aparece no Map (dia sem nenhum comprador identificável)", async () => {
    queryRaw.mockResolvedValueOnce([{ day: new Date("2026-11-01T00:00:00.000Z"), clienteCadastroId: null, clienteNome: null }]);
    // Nem id nem nome resolvido -> função nem chama as queries de 1ª compra (nenhum id/nome pra buscar).

    const { getNovosClientesDiarioEcommerce } = await import("../cac");
    const result = await getNovosClientesDiarioEcommerce(CD_STORE_ID, FROM_DIA, TO_DIA);

    expect(result.has("2026-11-01")).toBe(false);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("dois clientes diferentes (ids distintos) no mesmo dia são contados separadamente, mesmo nome igual por coincidência", async () => {
    queryRaw
      .mockResolvedValueOnce([
        { day: new Date("2026-11-01T00:00:00.000Z"), clienteCadastroId: "cc-a", clienteNome: "Joao Silva" },
        { day: new Date("2026-11-01T00:00:00.000Z"), clienteCadastroId: "cc-b", clienteNome: "Joao Silva" },
      ])
      .mockResolvedValueOnce([
        { clienteCadastroId: "cc-a", first: new Date("2026-11-01T09:00:00-03:00") }, // novo
        { clienteCadastroId: "cc-b", first: new Date("2025-01-01T09:00:00-03:00") }, // recorrente
      ])
      .mockResolvedValueOnce([]);

    const { getNovosClientesDiarioEcommerce } = await import("../cac");
    const result = await getNovosClientesDiarioEcommerce(CD_STORE_ID, FROM_DIA, TO_DIA);

    expect(result.get("2026-11-01")).toEqual({ novos: 1, recorrentes: 1, naoIdentificados: 0 });
  });

  it("ClienteCadastro.primeiraCompraExterna mais antiga que a 1ª venda em Sale vence (histórico pré-DAPIC)", async () => {
    queryRaw
      .mockResolvedValueOnce([{ day: new Date("2026-11-01T00:00:00.000Z"), clienteCadastroId: "cc-3", clienteNome: "Cliente Antigo" }])
      .mockResolvedValueOnce([{ clienteCadastroId: "cc-3", first: new Date("2026-11-01T09:00:00-03:00") }])
      .mockResolvedValueOnce([{ id: "cc-3", first: new Date("2022-05-01T00:00:00-03:00") }]);

    const { getNovosClientesDiarioEcommerce } = await import("../cac");
    const result = await getNovosClientesDiarioEcommerce(CD_STORE_ID, FROM_DIA, TO_DIA);

    // primeiraCompraExterna (2022) é mais antiga que a venda do dia -> recorrente, não novo.
    expect(result.get("2026-11-01")).toEqual({ novos: 0, recorrentes: 1, naoIdentificados: 0 });
  });

  it("mesmo dia com 1 venda via id (clienteCadastroId) e 1 via fallback de nome são somadas no mesmo dia", async () => {
    queryRaw
      .mockResolvedValueOnce([
        { day: new Date("2026-11-01T00:00:00.000Z"), clienteCadastroId: "cc-x", clienteNome: "Com Cadastro" },
        { day: new Date("2026-11-01T00:00:00.000Z"), clienteCadastroId: null, clienteNome: "Sem Cadastro" },
      ])
      .mockResolvedValueOnce([{ clienteCadastroId: "cc-x", first: new Date("2025-01-01T00:00:00-03:00") }]) // primeiraPorSale -> recorrente
      .mockResolvedValueOnce([]) // externaRows (por id)
      .mockResolvedValueOnce([{ norm: "SEM CADASTRO", first: new Date("2026-11-01T08:00:00-03:00") }]) // primeiraPorNome -> novo
      .mockResolvedValueOnce([]); // externaPorNome

    const { getNovosClientesDiarioEcommerce } = await import("../cac");
    const result = await getNovosClientesDiarioEcommerce(CD_STORE_ID, FROM_DIA, TO_DIA);

    expect(result.get("2026-11-01")).toEqual({ novos: 1, recorrentes: 1, naoIdentificados: 0 });
  });

  it("ClienteCadastro.primeiraCompraExterna via NOME (sem id vinculado) mais antiga que a venda vence -> recorrente", async () => {
    queryRaw
      .mockResolvedValueOnce([{ day: new Date("2026-11-01T00:00:00.000Z"), clienteCadastroId: null, clienteNome: "Cliente Antigo Sem Id" }])
      .mockResolvedValueOnce([{ norm: "CLIENTE ANTIGO SEM ID", first: new Date("2026-11-01T09:00:00-03:00") }]) // primeiraPorNome
      .mockResolvedValueOnce([{ norm: "CLIENTE ANTIGO SEM ID", first: new Date("2021-03-01T00:00:00-03:00") }]); // externaPorNome, mais antiga

    const { getNovosClientesDiarioEcommerce } = await import("../cac");
    const result = await getNovosClientesDiarioEcommerce(CD_STORE_ID, FROM_DIA, TO_DIA);

    expect(result.get("2026-11-01")).toEqual({ novos: 0, recorrentes: 1, naoIdentificados: 0 });
  });

  it("nenhuma venda no período devolve Map vazio, sem chamar as queries de 1ª compra", async () => {
    queryRaw.mockResolvedValueOnce([]);

    const { getNovosClientesDiarioEcommerce } = await import("../cac");
    const result = await getNovosClientesDiarioEcommerce(CD_STORE_ID, FROM_DIA, TO_DIA);

    expect(result.size).toBe(0);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe("getInvestimentoDiarioAquisicao — encanamento pro conector (time_increment diário)", () => {
  it("repassa since/until (fuso Brasília) pro conector e devolve o Map tal como veio", async () => {
    getGastoDiarioConta.mockResolvedValue(new Map([["2026-11-01", 100], ["2026-11-02", 200]]));

    const { getInvestimentoDiarioAquisicao } = await import("../cac");
    const result = await getInvestimentoDiarioAquisicao(
      new Date("2026-11-01T00:00:00-03:00"),
      new Date("2026-11-02T23:59:59-03:00")
    );

    expect(result.get("2026-11-01")).toBe(100);
    expect(result.get("2026-11-02")).toBe(200);
    expect(getGastoDiarioConta).toHaveBeenCalledWith("2026-11-01", "2026-11-02");
  });

  it("erro do conector (credenciais ausentes) propaga — quem chama decide o fallback, nunca resolve pra Map vazio aqui", async () => {
    getGastoDiarioConta.mockRejectedValue(new Error("META_AD_ACCOUNT_ID / META_ACCESS_TOKEN não configurados"));

    const { getInvestimentoDiarioAquisicao } = await import("../cac");
    await expect(
      getInvestimentoDiarioAquisicao(new Date("2026-11-01T00:00:00-03:00"), new Date("2026-11-02T23:59:59-03:00"))
    ).rejects.toThrow(/META_AD_ACCOUNT_ID/);
  });
});
