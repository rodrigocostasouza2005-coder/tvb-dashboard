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
//   Secret do app "Radar Meta" (id 2276305833216685). Ver exchangeForLongLivedToken().

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
