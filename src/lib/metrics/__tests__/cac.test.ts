import { describe, it, expect, vi, beforeEach } from "vitest";

const storeFindFirst = vi.fn();
const saleGroupBy = vi.fn();
const queryRaw = vi.fn();
const getInsightsPorConjunto = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findFirst: (...a: unknown[]) => storeFindFirst(...a) },
    sale: { groupBy: (...a: unknown[]) => saleGroupBy(...a) },
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
  },
}));

vi.mock("@/lib/connectors/meta-ads", () => ({
  getInsightsPorConjunto: (...a: unknown[]) => getInsightsPorConjunto(...a),
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
