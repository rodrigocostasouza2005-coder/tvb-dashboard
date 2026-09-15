// Conector do Meta Marketing API (Facebook/Instagram Ads) — pedido do Rodrigo em 2026-09-15,
// pra mostrar as fotos dos anúncios na aba Analytics do Site.
//
// Achado importante testando contra a conta real: o que o GA4 rastreia como "anúncio"
// (sessionManualAdContent, ver google-analytics.ts) na verdade bate com nome de CONJUNTO de
// anúncios, não de um anúncio individual — o utm_content é configurado no nível do conjunto nos
// links de vocês. Um conjunto só ("BOHO_ADV+ Conjunto de anúncios") tem mais de 20 anúncios
// diferentes dentro, a maioria pausada. Por isso a foto mostrada é uma mini-galeria dos anúncios
// ATIVOS daquele conjunto (Rodrigo escolheu essa opção em 2026-09-15), não uma foto única.
//
// Precisa de duas env vars:
// - META_AD_ACCOUNT_ID: id da conta de anúncios, sem o prefixo "act_" (ex: "460450997927928").
// - META_ACCESS_TOKEN: token de usuário com permissão ads_read, de preferência de longa duração
//   (~60 dias) — trocado a partir de um token curto do Explorador da API Graph usando o App
//   Secret do app "Radar Meta" (id 2276305833216685), via GET /oauth/access_token com
//   grant_type=fb_exchange_token (feito manualmente, sem helper aqui — é um passo único, não
//   recorrente no código).

import type { PrismaClient } from "@prisma/client";

const GRAPH_API_VERSION = "v21.0";

function getCredentials() {
  const accountId = process.env.META_AD_ACCOUNT_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accountId || !accessToken) {
    throw new Error("META_AD_ACCOUNT_ID / META_ACCESS_TOKEN não configurados — falta conectar o Meta Ads.");
  }
  return { accountId, accessToken };
}

type MetaGraphResponse<T> = { data?: T[]; error?: { message: string }; paging?: { next?: string } };

async function fetchAllPages<T>(url: string): Promise<T[]> {
  const results: T[] = [];
  let next: string | undefined = url;
  while (next) {
    const res = await fetch(next);
    const json: MetaGraphResponse<T> = await res.json();
    if (json.error) throw new Error(`Meta Ads API: ${json.error.message}`);
    results.push(...(json.data ?? []));
    next = json.paging?.next;
  }
  return results;
}

type MetaAdSet = { id: string; name: string };
type MetaAd = { id: string; name: string; status: string; creative?: { thumbnail_url?: string } };

async function fetchAdSets(): Promise<MetaAdSet[]> {
  const { accountId, accessToken } = getCredentials();
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${accountId}/adsets?fields=id,name&limit=200&access_token=${accessToken}`;
  return fetchAllPages<MetaAdSet>(url);
}

// Só os anúncios ATIVOS do conjunto — anúncio pausado não é relevante pra "o que tá no ar agora".
async function fetchFotosAtivas(adsetId: string, limit = 5): Promise<string[]> {
  const { accessToken } = getCredentials();
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${adsetId}/ads?fields=id,status,creative{thumbnail_url}&limit=50&access_token=${accessToken}`;
  const ads = await fetchAllPages<MetaAd>(url);
  return ads
    .filter((a) => a.status === "ACTIVE" && a.creative?.thumbnail_url)
    .slice(0, limit)
    .map((a) => a.creative!.thumbnail_url!);
}

const FOTOS_MAX_AGE_HORAS = 12;
const CACHE_LABEL = "meta-ads-fotos";

// Cacheado (mesmo padrão de fetchPriceCatalogCached em tabela-preco.ts, reaproveitando o modelo
// PriceCatalogCache) — evita bater na API do Meta a cada carregamento de página. Busca só os
// nomes de conjunto que ainda não tem no cache (ou tudo, se o cache passou de 12h), não a conta
// inteira — o "Anúncios" da tela só mostra top ~15 por sessão, não faz sentido buscar todos os
// conjuntos (alguns tem +20 anúncios cada, ia ficar lento).
export async function getFotosPorNomeConjunto(
  prisma: PrismaClient,
  nomesConjuntos: string[]
): Promise<Map<string, string[]>> {
  const cached = await prisma.priceCatalogCache.findUnique({ where: { clientLabel: CACHE_LABEL } });
  const cachedData = (cached?.data as Record<string, string[]>) ?? {};
  const isFresh = cached != null && Date.now() - cached.updatedAt.getTime() < FOTOS_MAX_AGE_HORAS * 60 * 60 * 1000;

  const faltando = nomesConjuntos.filter((n) => !(n in cachedData));
  if (isFresh && faltando.length === 0) {
    return new Map(nomesConjuntos.map((n) => [n, cachedData[n] ?? []]));
  }

  const adsets = await fetchAdSets();
  const nomesParaBuscar = isFresh ? faltando : nomesConjuntos;
  const novosDados: Record<string, string[]> = { ...cachedData };
  for (const nome of nomesParaBuscar) {
    const adset = adsets.find((a) => a.name === nome);
    novosDados[nome] = adset ? await fetchFotosAtivas(adset.id) : [];
  }

  await prisma.priceCatalogCache.upsert({
    where: { clientLabel: CACHE_LABEL },
    create: { clientLabel: CACHE_LABEL, data: novosDados },
    update: { data: novosDados },
  });

  return new Map(nomesConjuntos.map((n) => [n, novosDados[n] ?? []]));
}

// Investimento/performance por conjunto (2026-09-15, pedido do Rodrigo — gasto, ROAS, cliques,
// CTR, CPC, CPM, custo por compra). Uma chamada só pra conta inteira (level=adset), não uma por
// conjunto — bem mais barato que a busca de fotos. "purchase_roas" é o retorno que o próprio
// Meta calcula (receita atribuída ao pixel ÷ gasto) — o mais próximo de "ROI" que a API oferece
// direto, sem eu precisar inventar uma conta própria. Sem cache: um valor por conta só, já é
// rápido, e gasto muda todo dia (cache velho ia mostrar número defasado sem necessidade).
export type MetaInsight = {
  gasto: number;
  impressoes: number;
  alcance: number;
  cliques: number;
  ctrPct: number;
  cpc: number;
  cpm: number;
  compras: number;
  roas: number | null;
  custoPorCompra: number | null;
};

type MetaAction = { action_type: string; value: string };
type MetaAdSetInsightRow = {
  adset_name: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: MetaAction[];
  purchase_roas?: MetaAction[];
};

export async function getInsightsPorConjunto(range: { since: string; until: string }): Promise<Map<string, MetaInsight>> {
  const { accountId, accessToken } = getCredentials();
  const timeRange = encodeURIComponent(JSON.stringify(range));
  const fields = "adset_name,spend,impressions,reach,clicks,ctr,cpc,cpm,actions,purchase_roas";
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${accountId}/insights?level=adset&fields=${fields}&time_range=${timeRange}&limit=200&access_token=${accessToken}`;
  const rows = await fetchAllPages<MetaAdSetInsightRow>(url);

  const map = new Map<string, MetaInsight>();
  for (const r of rows) {
    const gasto = Number(r.spend ?? 0);
    const compras = Number(r.actions?.find((a) => a.action_type === "purchase")?.value ?? 0);
    const roasEntry = r.purchase_roas?.find((p) => p.action_type === "omni_purchase") ?? r.purchase_roas?.[0];
    map.set(r.adset_name, {
      gasto,
      impressoes: Number(r.impressions ?? 0),
      alcance: Number(r.reach ?? 0),
      cliques: Number(r.clicks ?? 0),
      ctrPct: Number(r.ctr ?? 0),
      cpc: Number(r.cpc ?? 0),
      cpm: Number(r.cpm ?? 0),
      compras,
      roas: roasEntry ? Number(roasEntry.value) : null,
      custoPorCompra: compras > 0 ? gasto / compras : null,
    });
  }
  return map;
}
