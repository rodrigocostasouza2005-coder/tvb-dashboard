import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock do client oficial do GA4 (@google-analytics/data) — mesmo espírito do mock de `fetch`
// usado em meta-ads.test.ts: nunca bate na API real, só verifica o que o conector faz com a
// resposta (inclusive respostas de erro, pra garantir que falha de API não vira zero silencioso).
const runReport = vi.fn();
vi.mock("@google-analytics/data", () => ({
  BetaAnalyticsDataClient: vi.fn().mockImplementation(() => ({ runReport })),
}));

function setEnv() {
  process.env.GA4_PROPERTY_ID = "123456789";
  process.env.GA4_SERVICE_ACCOUNT_KEY = JSON.stringify({
    client_email: "svc@tvb-shorts.iam.gserviceaccount.com",
    private_key: "fake-key",
  });
}

async function importFresh() {
  vi.resetModules();
  return import("../google-analytics");
}

function row(dimValues: string[], metricValues: string[]) {
  return {
    dimensionValues: dimValues.map((v) => ({ value: v })),
    metricValues: metricValues.map((v) => ({ value: v })),
  };
}

beforeEach(() => {
  runReport.mockReset();
  delete process.env.GA4_PROPERTY_ID;
  delete process.env.GA4_SERVICE_ACCOUNT_KEY;
});

describe("getClient/getPropertyPath — credencial ausente lança erro claro, nunca dado fictício", () => {
  it("GA4_SERVICE_ACCOUNT_KEY ausente: getSessoesPorDia rejeita com mensagem clara", async () => {
    process.env.GA4_PROPERTY_ID = "123456789";
    const { getSessoesPorDia } = await importFresh();
    await expect(getSessoesPorDia({ startDate: "7daysAgo", endDate: "today" })).rejects.toThrow(
      /GA4_SERVICE_ACCOUNT_KEY/
    );
  });

  it("GA4_PROPERTY_ID ausente: getSessoesPorDia rejeita com mensagem clara", async () => {
    process.env.GA4_SERVICE_ACCOUNT_KEY = JSON.stringify({ client_email: "a@b.com", private_key: "x" });
    const { getSessoesPorDia } = await importFresh();
    await expect(getSessoesPorDia({ startDate: "7daysAgo", endDate: "today" })).rejects.toThrow(/GA4_PROPERTY_ID/);
  });
});

describe("falha de API propaga como erro — nunca é engolida e virada 0 (padrão do bug de Meta Ads)", () => {
  beforeEach(setEnv);

  it("getSessoesPorDia: runReport rejeitando (token inválido/rate limit) propaga a rejeição", async () => {
    runReport.mockRejectedValue(new Error("GA4 API: 429 rate limit exceeded"));
    const { getSessoesPorDia } = await importFresh();
    await expect(getSessoesPorDia({ startDate: "7daysAgo", endDate: "today" })).rejects.toThrow(/rate limit/);
  });

  it("getFunilCompra: runReport rejeitando propaga — não aparece como funil zerado (indistinguível de 'sem evento')", async () => {
    runReport.mockRejectedValue(new Error("GA4 API: permission denied na propriedade"));
    const { getFunilCompra } = await importFresh();
    await expect(getFunilCompra({ startDate: "7daysAgo", endDate: "today" })).rejects.toThrow(/permission denied/);
  });

  it("getConversoes: runReport rejeitando propaga em vez de devolver sessoes/conversoes = 0", async () => {
    runReport.mockRejectedValue(new Error("GA4 API: deadline exceeded"));
    const { getConversoes } = await importFresh();
    await expect(getConversoes({ startDate: "7daysAgo", endDate: "today" })).rejects.toThrow(/deadline exceeded/);
  });
});

describe("getFunilCompra — zero legítimo (evento não configurado) é distinto de erro de API", () => {
  beforeEach(setEnv);

  it("evento ausente na resposta (mas API respondeu com sucesso) conta como 0, funil não quebra", async () => {
    // API respondeu com sucesso mas só manda 3 dos 5 eventos (ex: loja não manda add_payment_info).
    runReport.mockResolvedValue([
      {
        rows: [
          row(["view_item"], ["500"]),
          row(["add_to_cart"], ["200"]),
          row(["purchase"], ["40"]),
        ],
      },
    ]);
    const { getFunilCompra } = await importFresh();
    const funil = await getFunilCompra({ startDate: "7daysAgo", endDate: "today" });

    expect(funil.map((f) => f.eventos)).toEqual([500, 200, 0, 0, 40]);
    // pctDoInicio da etapa ausente é 0% (sobre o total de view_item), não null/erro.
    expect(funil[2].pctDoInicio).toBe(0);
  });

  it("calcula pctDoAnterior e pctDoInicio corretamente ao longo do funil", async () => {
    runReport.mockResolvedValue([
      {
        rows: [
          row(["view_item"], ["1000"]),
          row(["add_to_cart"], ["400"]),
          row(["begin_checkout"], ["200"]),
          row(["add_payment_info"], ["150"]),
          row(["purchase"], ["100"]),
        ],
      },
    ]);
    const { getFunilCompra } = await importFresh();
    const funil = await getFunilCompra({ startDate: "7daysAgo", endDate: "today" });

    expect(funil[0].pctDoAnterior).toBeNull(); // primeira etapa não tem "anterior"
    expect(funil[1].pctDoAnterior).toBeCloseTo(40); // 400/1000
    expect(funil[4].pctDoInicio).toBeCloseTo(10); // 100/1000
  });
});

describe("getPaginasMaisVistas — bug real corrigido: título mudando no período não pode fragmentar a mesma página", () => {
  beforeEach(setEnv);

  it("agrupa visualizações pelo mesmo pagePath mesmo com pageTitle diferente entre linhas", async () => {
    // "/produto/boho" aparece com 2 títulos diferentes (teste de SEO no meio do período) — antes
    // da correção, essas duas linhas ficavam separadas e cada uma concorria isoladamente pelo
    // limite de exibição, perdendo o ranking real da página.
    runReport.mockResolvedValue([
      {
        rows: [
          row(["/produto/boho", "Vestido Boho"], ["300"]),
          row(["/produto/boho", "Vestido Boho | Promoção"], ["250"]),
          row(["/produto/outro", "Outro Produto"], ["400"]),
        ],
      },
    ]);
    const { getPaginasMaisVistas } = await importFresh();
    const paginas = await getPaginasMaisVistas({ startDate: "7daysAgo", endDate: "today" }, 20);

    // "/produto/boho" soma 300+250=550 e fica em #1, na frente de "/produto/outro" (400) — sem a
    // correção, cada linha isolada (300 e 250) perderia pra 400 e a página sairia do topo.
    expect(paginas[0]).toEqual({ caminho: "/produto/boho", titulo: "Vestido Boho", visualizacoes: 550 });
    expect(paginas[1]).toEqual({ caminho: "/produto/outro", titulo: "Outro Produto", visualizacoes: 400 });
    expect(paginas).toHaveLength(2);
  });

  it("pede um lote grande à API (não o limite de exibição) para poder agrupar antes de cortar", async () => {
    runReport.mockResolvedValue([{ rows: [] }]);
    const { getPaginasMaisVistas } = await importFresh();
    await getPaginasMaisVistas({ startDate: "7daysAgo", endDate: "today" }, 5);

    const callArg = runReport.mock.calls[0][0];
    expect(callArg.limit).not.toBe(5);
    expect(callArg.limit).toBeGreaterThanOrEqual(1000);
  });

  it("respeita o limite de exibição (top N) só depois de agrupar por página", async () => {
    runReport.mockResolvedValue([
      {
        rows: [
          row(["/a", "A"], ["10"]),
          row(["/b", "B"], ["9"]),
          row(["/c", "C"], ["8"]),
        ],
      },
    ]);
    const { getPaginasMaisVistas } = await importFresh();
    const paginas = await getPaginasMaisVistas({ startDate: "7daysAgo", endDate: "today" }, 2);
    expect(paginas).toHaveLength(2);
    expect(paginas.map((p) => p.caminho)).toEqual(["/a", "/b"]);
  });
});

describe("getSessoesPorHora — preenche as 24 horas mesmo com dado esparso, sem perder nem duplicar", () => {
  beforeEach(setEnv);

  it("horas sem sessão vêm 0, horas com dado batem com a API", async () => {
    runReport.mockResolvedValue([
      { rows: [row(["00"], ["10"]), row(["14"], ["99"]), row(["23"], ["5"])] },
    ]);
    const { getSessoesPorHora } = await importFresh();
    const porHora = await getSessoesPorHora({ startDate: "7daysAgo", endDate: "today" });

    expect(porHora).toHaveLength(24);
    expect(porHora.find((h) => h.hora === "0")?.sessoes).toBe(10);
    expect(porHora.find((h) => h.hora === "14")?.sessoes).toBe(99);
    expect(porHora.find((h) => h.hora === "23")?.sessoes).toBe(5);
    expect(porHora.find((h) => h.hora === "1")?.sessoes).toBe(0);
  });
});

describe("getConversoes — taxa de conversão null (não 0) quando não há sessão, pra não fingir 0%", () => {
  beforeEach(setEnv);

  it("sem sessão no período: taxaConversaoPct é null, não 0", async () => {
    runReport.mockResolvedValue([{ rows: [row([], ["0", "0", "0"])] }]);
    const { getConversoes } = await importFresh();
    const conv = await getConversoes({ startDate: "7daysAgo", endDate: "today" });
    expect(conv).toEqual({ sessoes: 0, usuarios: 0, conversoes: 0, taxaConversaoPct: null });
  });

  it("com sessão: taxa calculada corretamente", async () => {
    runReport.mockResolvedValue([{ rows: [row([], ["200", "150", "20"])] }]);
    const { getConversoes } = await importFresh();
    const conv = await getConversoes({ startDate: "7daysAgo", endDate: "today" });
    expect(conv.taxaConversaoPct).toBeCloseTo(10);
  });
});

describe("getGeografia — descarta cidade (not set) sem derrubar as demais linhas", () => {
  beforeEach(setEnv);

  it("filtra só a linha '(not set)', mantém as outras intactas", async () => {
    runReport.mockResolvedValue([
      {
        rows: [
          row(["São Paulo", "State of São Paulo"], ["500"]),
          row(["(not set)", "(not set)"], ["50"]),
          row(["Curitiba", "State of Paraná"], ["100"]),
        ],
      },
    ]);
    const { getGeografia } = await importFresh();
    const geo = await getGeografia({ startDate: "7daysAgo", endDate: "today" });

    expect(geo).toEqual([
      { cidade: "São Paulo", estado: "São Paulo", sessoes: 500 },
      { cidade: "Curitiba", estado: "Paraná", sessoes: 100 },
    ]);
  });
});

describe("getOrigemTrafego — cada canal fica em sua própria linha, sem somar canais diferentes juntos", () => {
  beforeEach(setEnv);

  it("traduz o canal conhecido e preserva sessões/conversões por linha, sem colapsar canais distintos", async () => {
    runReport.mockResolvedValue([
      {
        rows: [
          row(["Paid Social"], ["300", "30"]),
          row(["Organic Search"], ["200", "10"]),
        ],
      },
    ]);
    const { getOrigemTrafego } = await importFresh();
    const origem = await getOrigemTrafego({ startDate: "7daysAgo", endDate: "today" });

    expect(origem).toEqual([
      { canal: "Social pago", sessoes: 300, conversoes: 30 },
      { canal: "Busca orgânica", sessoes: 200, conversoes: 10 },
    ]);
  });
});
