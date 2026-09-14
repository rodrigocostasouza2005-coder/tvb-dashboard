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
// AINDA NÃO TESTADO CONTRA A API REAL — escrito em cima da documentação oficial da GA4 Data API
// (@google-analytics/data). Testar assim que a chave de serviço estiver configurada, antes de
// confiar nos números.

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

export type Ga4Conversao = { sessoes: number; conversoes: number; taxaConversaoPct: number | null };

export async function getConversoes(range: Ga4DateRange): Promise<Ga4Conversao> {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: [range],
    metrics: [{ name: "sessions" }, { name: "conversions" }],
  });

  const row = response.rows?.[0];
  const sessoes = Number(row?.metricValues?.[0].value ?? 0);
  const conversoes = Number(row?.metricValues?.[1].value ?? 0);
  return { sessoes, conversoes, taxaConversaoPct: sessoes > 0 ? (conversoes / sessoes) * 100 : null };
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
    canal: r.dimensionValues?.[0].value ?? "(não definido)",
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
