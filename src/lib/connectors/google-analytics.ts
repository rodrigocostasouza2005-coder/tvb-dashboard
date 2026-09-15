// Conector do Google Analytics 4 (GA4) — pedido do Rodrigo em 2026-09-14, pra alimentar a aba
// Marketing com sessões, conversão, origem de tráfego e páginas mais vistas (hoje só tem um
// placeholder dizendo "ainda não conectado"). Mesmo espírito do connectors/dapic.ts: credencial
// ausente lança erro claro em vez de devolver dado fictício.
//
// Precisa de duas env vars:
// - GA4_PROPERTY_ID: o número da propriedade GA4 (Admin → Detalhes da propriedade).
// - GA4_SERVICE_ACCOUNT_KEY: o JSON inteiro da conta de serviço (numa linha só), com acesso de
//   Leitor concedido na propriedade (Admin → Acesso à propriedade).
//
// Testado ao vivo contra a propriedade real em 2026-09-14 (sessões, conversão, origem de
// tráfego, páginas, dispositivo, geografia, novo vs recorrente, campanhas e funil de compra —
// confirmado que a Shopify manda os eventos de e-commerce certos: view_item, add_to_cart,
// begin_checkout, add_payment_info, purchase).

import { BetaAnalyticsDataClient } from "@google-analytics/data";

let client: BetaAnalyticsDataClient | null = null;

function getClient(): BetaAnalyticsDataClient {
  if (client) return client;
  const rawKey = process.env.GA4_SERVICE_ACCOUNT_KEY;
  if (!rawKey) {
    throw new Error(
      "GA4_SERVICE_ACCOUNT_KEY não configurado — falta conectar a conta de serviço do Google Analytics."
    );
  }
  let credentials: { client_email: string; private_key: string };
  try {
    credentials = JSON.parse(rawKey);
  } catch {
    throw new Error("GA4_SERVICE_ACCOUNT_KEY não é um JSON válido.");
  }
  client = new BetaAnalyticsDataClient({ credentials });
  return client;
}

function getPropertyPath(): string {
  const id = process.env.GA4_PROPERTY_ID;
  if (!id) throw new Error("GA4_PROPERTY_ID não configurado.");
  return `properties/${id}`;
}

export type Ga4DateRange = { startDate: string; endDate: string }; // "YYYY-MM-DD" ou "NdaysAgo"/"today"

export type Ga4Sessao = { data: string; sessoes: number };

export async function getSessoesPorDia(range: Ga4DateRange): Promise<Ga4Sessao[]> {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: [range],
    dimensions: [{ name: "date" }],
    metrics: [{ name: "sessions" }],
    orderBys: [{ dimension: { dimensionName: "date" } }],
  });

  return (response.rows ?? []).map((r) => ({
    // GA4 devolve a data como "YYYYMMDD" sem separador.
    data: `${r.dimensionValues?.[0].value?.slice(0, 4)}-${r.dimensionValues?.[0].value?.slice(4, 6)}-${r.dimensionValues?.[0].value?.slice(6, 8)}`,
    sessoes: Number(r.metricValues?.[0].value ?? 0),
  }));
}

export type Ga4Conversao = {
  sessoes: number;
  usuarios: number;
  conversoes: number;
  taxaConversaoPct: number | null;
};

export async function getConversoes(range: Ga4DateRange): Promise<Ga4Conversao> {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: [range],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "conversions" }],
  });

  const row = response.rows?.[0];
  const sessoes = Number(row?.metricValues?.[0].value ?? 0);
  const usuarios = Number(row?.metricValues?.[1].value ?? 0);
  const conversoes = Number(row?.metricValues?.[2].value ?? 0);
  return { sessoes, usuarios, conversoes, taxaConversaoPct: sessoes > 0 ? (conversoes / sessoes) * 100 : null };
}

// Nomes de canal ("Default Channel Group") vêm sempre em inglês da API, não tem opção de
// idioma — traduzido aqui pra ficar legível pro Rodrigo. Lista fixa dos grupos padrão do GA4
// (Google Analytics 4 Help, "Default channel group"); canal novo que o Google inventar e não
// estiver aqui aparece sem tradução (melhor que traduzir errado).
const CANAL_TRADUZIDO: Record<string, string> = {
  "Direct": "Direto",
  "Organic Search": "Busca orgânica",
  "Paid Search": "Busca paga",
  "Organic Social": "Social orgânico",
  "Paid Social": "Social pago",
  "Organic Video": "Vídeo orgânico",
  "Paid Video": "Vídeo pago",
  "Organic Shopping": "Shopping orgânico",
  "Paid Shopping": "Shopping pago",
  "Email": "E-mail",
  "Affiliates": "Afiliados",
  "Referral": "Referência",
  "Display": "Display",
  "SMS": "SMS",
  "Mobile Push Notifications": "Notificação push",
  "Audio": "Áudio",
  "Cross-network": "Múltiplos canais",
  "Unassigned": "Não atribuído",
  "AI Assistant": "Assistente de IA",
  "AI Search": "Busca por IA",
};

function traduzirCanal(canal: string): string {
  return CANAL_TRADUZIDO[canal] ?? canal;
}

export type Ga4OrigemTrafego = { canal: string; sessoes: number; conversoes: number };

export async function getOrigemTrafego(range: Ga4DateRange): Promise<Ga4OrigemTrafego[]> {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: [range],
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }, { name: "conversions" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
  });

  return (response.rows ?? []).map((r) => ({
    canal: traduzirCanal(r.dimensionValues?.[0].value ?? "(não definido)"),
    sessoes: Number(r.metricValues?.[0].value ?? 0),
    conversoes: Number(r.metricValues?.[1].value ?? 0),
  }));
}

export type Ga4PaginaMaisVista = { caminho: string; titulo: string; visualizacoes: number };

export async function getPaginasMaisVistas(range: Ga4DateRange, limit = 20): Promise<Ga4PaginaMaisVista[]> {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: [range],
    dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
    metrics: [{ name: "screenPageViews" }],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit,
  });

  return (response.rows ?? []).map((r) => ({
    caminho: r.dimensionValues?.[0].value ?? "",
    titulo: r.dimensionValues?.[1].value ?? "",
    visualizacoes: Number(r.metricValues?.[0].value ?? 0),
  }));
}

const DISPOSITIVO_TRADUZIDO: Record<string, string> = {
  mobile: "Celular",
  desktop: "Computador",
  tablet: "Tablet",
  "smart tv": "Smart TV",
};

export type Ga4Dispositivo = { dispositivo: string; sessoes: number; conversoes: number; participacaoPct: number };

export async function getDispositivos(range: Ga4DateRange): Promise<Ga4Dispositivo[]> {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: [range],
    dimensions: [{ name: "deviceCategory" }],
    metrics: [{ name: "sessions" }, { name: "conversions" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
  });

  const rows = response.rows ?? [];
  const total = rows.reduce((s, r) => s + Number(r.metricValues?.[0].value ?? 0), 0);
  return rows.map((r) => {
    const sessoes = Number(r.metricValues?.[0].value ?? 0);
    const bruto = r.dimensionValues?.[0].value ?? "(não definido)";
    return {
      dispositivo: DISPOSITIVO_TRADUZIDO[bruto] ?? bruto,
      sessoes,
      conversoes: Number(r.metricValues?.[1].value ?? 0),
      participacaoPct: total > 0 ? (sessoes / total) * 100 : 0,
    };
  });
}

export type Ga4Cidade = { cidade: string; estado: string; sessoes: number };

export async function getGeografia(range: Ga4DateRange, limit = 15): Promise<Ga4Cidade[]> {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: [range],
    dimensions: [{ name: "city" }, { name: "region" }],
    metrics: [{ name: "sessions" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit,
  });

  return (response.rows ?? [])
    .map((r) => ({
      cidade: r.dimensionValues?.[0].value ?? "(não definida)",
      // GA4 devolve "State of Rio de Janeiro" em inglês — tira só o prefixo (não tenta
      // traduzir o nome do estado inteiro, pra não arriscar erro nos que fogem do padrão).
      estado: (r.dimensionValues?.[1].value ?? "").replace(/^State of /, ""),
      sessoes: Number(r.metricValues?.[0].value ?? 0),
    }))
    .filter((c) => c.cidade !== "(not set)");
}

const VISITANTE_TRADUZIDO: Record<string, string> = { new: "Novo", returning: "Recorrente" };

export type Ga4NovoVsRecorrente = { tipo: string; sessoes: number; conversoes: number; participacaoPct: number };

export async function getNovoVsRecorrente(range: Ga4DateRange): Promise<Ga4NovoVsRecorrente[]> {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: [range],
    dimensions: [{ name: "newVsReturning" }],
    metrics: [{ name: "sessions" }, { name: "conversions" }],
  });

  // "(not set)" e string vazia são a mesma coisa aqui (sessão sem esse dado) — ambas descartadas.
  const rows = (response.rows ?? []).filter((r) => {
    const v = r.dimensionValues?.[0].value;
    return v && v !== "(not set)";
  });
  const total = rows.reduce((s, r) => s + Number(r.metricValues?.[0].value ?? 0), 0);
  return rows.map((r) => {
    const sessoes = Number(r.metricValues?.[0].value ?? 0);
    const bruto = r.dimensionValues?.[0].value ?? "";
    return {
      tipo: VISITANTE_TRADUZIDO[bruto] ?? bruto,
      sessoes,
      conversoes: Number(r.metricValues?.[1].value ?? 0),
      participacaoPct: total > 0 ? (sessoes / total) * 100 : 0,
    };
  });
}

// Origem/Mídia da sessão (2026-09-15, pedido do Rodrigo — substituiu a tabela de Campanhas, que
// ele achou menos útil). "sessionSourceMedium" já vem combinado do GA4 no formato "origem / mídia"
// (ex: "google / cpc", "instagram / social", "(direct) / (none)") — mais granular que o canal
// (getOrigemTrafego, que agrupa tipo "Paid Search"/"Organic Social") e não depende de UTM de
// campanha estar preenchido.
export type Ga4OrigemMidia = { origemMidia: string; sessoes: number; conversoes: number };

export async function getOrigemMidia(range: Ga4DateRange, limit = 15): Promise<Ga4OrigemMidia[]> {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: [range],
    dimensions: [{ name: "sessionSourceMedium" }],
    metrics: [{ name: "sessions" }, { name: "conversions" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit,
  });

  return (response.rows ?? []).map((r) => ({
    origemMidia: r.dimensionValues?.[0].value ?? "(não definida)",
    sessoes: Number(r.metricValues?.[0].value ?? 0),
    conversoes: Number(r.metricValues?.[1].value ?? 0),
  }));
}

// Funil padrão de e-commerce do GA4 — confirmado em 2026-09-14 que a Shopify manda esses 5
// eventos pra essa propriedade (não é garantido em toda loja Shopify, depende de como o pixel
// do GA4 foi instalado). Se um evento não existir, a contagem vem 0 (não quebra o funil, só
// mostra 0% de conversão daquele degrau em diante).
const ETAPAS_FUNIL = ["view_item", "add_to_cart", "begin_checkout", "add_payment_info", "purchase"] as const;
const ETAPA_LABEL: Record<(typeof ETAPAS_FUNIL)[number], string> = {
  view_item: "Viu o produto",
  add_to_cart: "Add. ao carrinho",
  begin_checkout: "Iniciou checkout",
  add_payment_info: "Add. pagamento",
  purchase: "Comprou",
};

export type Ga4EtapaFunil = { etapa: string; eventos: number; pctDoInicio: number | null; pctDoAnterior: number | null };

export async function getFunilCompra(range: Ga4DateRange): Promise<Ga4EtapaFunil[]> {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: [range],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      filter: { fieldName: "eventName", inListFilter: { values: [...ETAPAS_FUNIL] } },
    },
  });

  const porEvento = new Map<string, number>();
  for (const r of response.rows ?? []) {
    porEvento.set(r.dimensionValues?.[0].value ?? "", Number(r.metricValues?.[0].value ?? 0));
  }

  const primeiraEtapa = porEvento.get(ETAPAS_FUNIL[0]) ?? 0;
  let anterior: number | null = null;
  return ETAPAS_FUNIL.map((etapa) => {
    const eventos = porEvento.get(etapa) ?? 0;
    const pctDoAnterior = anterior != null && anterior > 0 ? (eventos / anterior) * 100 : null;
    anterior = eventos;
    return {
      etapa: ETAPA_LABEL[etapa],
      eventos,
      pctDoInicio: primeiraEtapa > 0 ? (eventos / primeiraEtapa) * 100 : null,
      pctDoAnterior,
    };
  });
}
