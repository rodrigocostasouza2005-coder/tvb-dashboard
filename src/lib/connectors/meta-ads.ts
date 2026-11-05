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
// Correção em 2026-10-06: "ativos" era um filtro estrito — conjunto com TODOS os anúncios
// pausados (comum pra campanha já encerrada, mas que ainda aparece no Top por gasto de um período
// passado) ficava sem nenhuma foto, mesmo tendo criativo de verdade disponível. fetchFotosAtivas
// agora prioriza anúncio ACTIVE com foto, e só cai pra PAUSED com foto quando não existe nenhum
// ativo — nunca mostra menos foto do que antes, só preenche o que ficava vazio à toa.
//
// Precisa de duas env vars:
// - META_AD_ACCOUNT_ID: id da conta de anúncios, sem o prefixo "act_" (ex: "460450997927928").
// - META_ACCESS_TOKEN: token de usuário com permissão ads_read, de preferência de longa duração
//   (~60 dias) — trocado a partir de um token curto do Explorador da API Graph usando o App
//   Secret do app "Radar Meta" (id 2276305833216685), via GET /oauth/access_token com
//   grant_type=fb_exchange_token (feito manualmente, sem helper aqui — é um passo único, não
//   recorrente no código).

import type { PrismaClient, Prisma } from "@prisma/client";

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

// Correção 2026-11-05 (missão Black Friday — bug real encontrado lendo o código): todas as
// funções abaixo que recebem uma lista de entidades do Meta (conjuntos/anúncios) e precisam
// achar "a entidade com esse nome" faziam isso com `.find()`/sobrescrita de Map por `name` —
// se DUAS entidades reais (ids diferentes) tiverem o mesmo nome (campanha reaproveitando nome,
// nome genérico tipo "Anúncio 1"), uma pisava silenciosamente na outra (status, foto ou
// insight de uma das duas simplesmente desaparecia, sem erro nenhum). `agruparPorNome` junta
// TODAS as entidades que compartilham um nome, pra quem for agregar decidir explicitamente como
// combinar (nunca por acidente/overwrite).
function agruparPorNome<T extends { name: string }>(itens: T[]): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const item of itens) {
    const lista = grupos.get(item.name);
    if (lista) lista.push(item);
    else grupos.set(item.name, [item]);
  }
  return grupos;
}

type MetaAdSet = { id: string; name: string; status: string };
// thumbnail_url cobre a esmagadora maioria dos criativos (confirmado em 2026-10-13: amostra de 40
// anúncios ativos/pausados da conta real, incluindo vídeo/Reels/carrossel dinâmico, 0 sem
// thumbnail_url) — o Meta já renderiza essa miniatura server-side pra praticamente todo tipo de
// criativo. Os campos abaixo são só fallback defensivo pro caso raro de vir vazio mesmo assim:
// video_data.image_url (post de vídeo/Reels), link_data.picture (anúncio de link legado) e a
// primeira imagem de asset_feed_spec (carrossel dinâmico/Advantage+ sem thumbnail renderizado).
type MetaCreative = {
  thumbnail_url?: string;
  object_story_spec?: {
    video_data?: { image_url?: string };
    link_data?: { picture?: string };
  };
  asset_feed_spec?: { images?: { url?: string }[] };
};
type MetaAd = { id: string; name: string; status: string; creative?: MetaCreative };

export function extrairFoto(creative: MetaCreative | undefined): string | undefined {
  if (!creative) return undefined;
  return (
    creative.thumbnail_url ||
    creative.object_story_spec?.video_data?.image_url ||
    creative.object_story_spec?.link_data?.picture ||
    creative.asset_feed_spec?.images?.find((img) => img.url)?.url ||
    undefined
  );
}

async function fetchAdSets(): Promise<MetaAdSet[]> {
  const { accountId, accessToken } = getCredentials();
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${accountId}/adsets?fields=id,name,status&limit=200&access_token=${accessToken}`;
  return fetchAllPages<MetaAdSet>(url);
}

// Lista crua cacheada (12h, mesmo padrão/TTL de getFotosPorNomeConjunto abaixo) — achado em
// 2026-10-01 (auditoria de performance): getStatusPorNomeConjunto e getFotosPorNomeConjunto
// chamavam fetchAdSets() cada uma por conta própria, sem cache nenhuma pro status — toda troca de
// filtro/F5 da Analytics batia a API do Meta 2x pra buscar a MESMA lista. Cacheando a lista crua
// uma vez só, as duas funções reaproveitam o mesmo dado.
const ADSETS_CACHE_LABEL = "meta-ads-adsets-raw";

async function fetchAdSetsCached(prisma: PrismaClient): Promise<MetaAdSet[]> {
  const cached = await prisma.priceCatalogCache.findUnique({ where: { clientLabel: ADSETS_CACHE_LABEL } });
  const isFresh = cached != null && Date.now() - cached.updatedAt.getTime() < FOTOS_MAX_AGE_HORAS * 60 * 60 * 1000;
  if (isFresh) return (cached!.data as unknown as MetaAdSet[]) ?? [];

  const fresh = await fetchAdSets();
  await prisma.priceCatalogCache.upsert({
    where: { clientLabel: ADSETS_CACHE_LABEL },
    create: { clientLabel: ADSETS_CACHE_LABEL, data: fresh as unknown as Prisma.InputJsonValue },
    update: { data: fresh as unknown as Prisma.InputJsonValue },
  });
  return fresh;
}

// Status (ativo/pausado) pra sinalizar na tabela de Investimento — pedido do Rodrigo em
// 2026-09-28. "status" aqui é o do CONJUNTO em si (ACTIVE/PAUSED/...), independente de ter tido
// gasto no período do insight (um conjunto pausado hoje pode ter gastado a semana toda).
export async function getStatusPorNomeConjunto(prisma: PrismaClient, nomesConjuntos: string[]): Promise<Map<string, boolean>> {
  const adsets = await fetchAdSetsCached(prisma);
  // Correção 2026-11-05: antes era `new Map(adsets.map(a => [a.name, ...]))` — se dois conjuntos
  // (ids diferentes) tiverem o mesmo nome, o Map sobrescrevia o status do primeiro com o do
  // segundo. Agora: ativo se QUALQUER um dos conjuntos com esse nome estiver ACTIVE (reflete a
  // realidade de "tem veiculação rodando com esse nome agora", sem perder nenhum dos dois).
  const porNome = agruparPorNome(adsets);
  return new Map(nomesConjuntos.map((n) => [n, (porNome.get(n) ?? []).some((a) => a.status === "ACTIVE")]));
}

export async function getStatusPorNomeAnuncio(prisma: PrismaClient, nomesAnuncios: string[]): Promise<Map<string, boolean>> {
  const ads = await fetchTodosAnunciosCached(prisma);
  // Mesma correção 2026-11-05 de getStatusPorNomeConjunto acima — antes pegava só o status do
  // PRIMEIRO anúncio daquele nome (`if (!porNome.has(...))`), podia reportar "pausado" com outro
  // anúncio do mesmo nome ativo de verdade. Agora: ativo se qualquer um dos ids com esse nome
  // estiver ACTIVE.
  const porNome = agruparPorNome(ads);
  return new Map(nomesAnuncios.map((n) => [n, (porNome.get(n) ?? []).some((a) => a.status === "ACTIVE")]));
}

// Prioriza anúncios ACTIVE do conjunto ("o que tá no ar agora") — só cai pra PAUSED (com foto)
// quando não sobra nenhum ativo com criativo, pra não mostrar "sem foto" num conjunto que já tem
// imagem disponível, só porque a campanha específica que gerou aquele anúncio já acabou.
// Sem limite de quantidade (pedido do Rodrigo em 2026-10-06) — mostra TODOS os anúncios com foto
// nessa categoria (ativos, ou pausados no fallback), não só os 5 primeiros.
async function fetchFotosAtivas(adsetId: string): Promise<string[]> {
  const { accessToken } = getCredentials();
  const fields = "id,status,creative{thumbnail_url,object_story_spec{video_data{image_url},link_data{picture}},asset_feed_spec{images}}";
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${adsetId}/ads?fields=${fields}&limit=50&access_token=${accessToken}`;
  const ads = await fetchAllPages<MetaAd>(url);
  const comFoto = ads
    .map((a) => ({ status: a.status, foto: extrairFoto(a.creative) }))
    .filter((a): a is { status: string; foto: string } => !!a.foto);
  const ativosComFoto = comFoto.filter((a) => a.status === "ACTIVE");
  const escolhidos = ativosComFoto.length > 0 ? ativosComFoto : comFoto;
  return escolhidos.map((a) => a.foto);
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

  const adsets = await fetchAdSetsCached(prisma);
  // Correção 2026-11-05: `.find()` pegava só o PRIMEIRO conjunto com esse nome — se existisse um
  // segundo conjunto (id diferente) com o mesmo nome, as fotos dele nunca apareciam, mesmo tendo
  // criativo de verdade disponível. Agora busca fotos de TODOS os conjuntos com esse nome e junta
  // (concat) — nunca perde veiculação legítima só por nome repetido.
  const porNome = agruparPorNome(adsets);
  const nomesParaBuscar = isFresh ? faltando : nomesConjuntos;
  const novosDados: Record<string, string[]> = { ...cachedData };
  for (const nome of nomesParaBuscar) {
    const grupos = porNome.get(nome) ?? [];
    const fotosPorGrupo = await Promise.all(grupos.map((a) => fetchFotosAtivas(a.id)));
    novosDados[nome] = fotosPorGrupo.flat();
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
  adset_id: string;
  adset_name: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  actions?: MetaAction[];
  purchase_roas?: MetaAction[];
};

// Acumulador bruto usado pra somar insights de entidades DIFERENTES (ids diferentes) que
// compartilham o mesmo nome, antes de derivar as métricas finais (ctr/cpc/cpm/roas) — nunca soma
// as métricas já calculadas (média de percentual estaria errada), sempre os valores brutos.
// `receita` é reconstruída como `roas * gasto` (o Meta só devolve o ratio já pronto, não a receita
// em si) só pra poder recalcular um ROAS agregado correto (receita total ÷ gasto total).
type RawInsightAcumulado = {
  gasto: number;
  impressoes: number;
  alcance: number;
  cliques: number;
  compras: number;
  receita: number;
};

type MetaInsightFields = {
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  actions?: MetaAction[];
  purchase_roas?: MetaAction[];
};

function parseRawInsight(r: MetaInsightFields): RawInsightAcumulado {
  const gasto = Number(r.spend ?? 0);
  const compras = Number(r.actions?.find((a) => a.action_type === "purchase")?.value ?? 0);
  const roasEntry = r.purchase_roas?.find((p) => p.action_type === "omni_purchase") ?? r.purchase_roas?.[0];
  const roas = roasEntry ? Number(roasEntry.value) : null;
  return {
    gasto,
    impressoes: Number(r.impressions ?? 0),
    alcance: Number(r.reach ?? 0),
    cliques: Number(r.clicks ?? 0),
    compras,
    receita: roas != null ? roas * gasto : 0,
  };
}

function somarRawInsight(a: RawInsightAcumulado, b: RawInsightAcumulado): RawInsightAcumulado {
  return {
    gasto: a.gasto + b.gasto,
    impressoes: a.impressoes + b.impressoes,
    alcance: a.alcance + b.alcance,
    cliques: a.cliques + b.cliques,
    compras: a.compras + b.compras,
    receita: a.receita + b.receita,
  };
}

function finalizarInsight(r: RawInsightAcumulado): MetaInsight {
  return {
    gasto: r.gasto,
    impressoes: r.impressoes,
    alcance: r.alcance,
    cliques: r.cliques,
    ctrPct: r.impressoes > 0 ? (r.cliques / r.impressoes) * 100 : 0,
    cpc: r.cliques > 0 ? r.gasto / r.cliques : 0,
    cpm: r.impressoes > 0 ? (r.gasto / r.impressoes) * 1000 : 0,
    compras: r.compras,
    roas: r.gasto > 0 ? r.receita / r.gasto : null,
    custoPorCompra: r.compras > 0 ? r.gasto / r.compras : null,
  };
}

// Correção 2026-11-05 (bug real encontrado lendo o código, missão Black Friday): a versão
// anterior fazia `map.set(r.adset_name, {...})` — se dois CONJUNTOS DIFERENTES (ids diferentes,
// ex: campanha reaproveitando nome) aparecessem na resposta do Meta com o mesmo `adset_name`, o
// insight do segundo SOBRESCREVIA o do primeiro inteiro, perdendo gasto/compras/ROAS de uma das
// duas veiculações silenciosamente — sem erro, sem log, só um número errado na tela.
//
// Agora agrega em duas etapas: 1) por `adset_id` (identidade real do Meta, nunca colide) — cada
// linha da API já é uma entidade única nesse nível; 2) por nome, SOMANDO os valores brutos de
// todos os ids que compartilham nome (gasto, impressões, cliques, compras, receita), e só então
// recalculando ctr/cpc/cpm/ROAS a partir dos totais somados — nunca escolhe um id arbitrariamente
// nem perde o outro. O Map por nome continua sendo o retorno público porque é o que a ponte com o
// GA4 precisa (GA4 só rastreia `sessionManualAdContent`, nunca o id real do Meta — ver
// google-analytics.ts).
export async function getInsightsPorConjunto(range: { since: string; until: string }): Promise<Map<string, MetaInsight>> {
  const { accountId, accessToken } = getCredentials();
  const timeRange = encodeURIComponent(JSON.stringify(range));
  const fields = "adset_id,adset_name,spend,impressions,reach,clicks,actions,purchase_roas";
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${accountId}/insights?level=adset&fields=${fields}&time_range=${timeRange}&limit=200&access_token=${accessToken}`;
  const rows = await fetchAllPages<MetaAdSetInsightRow>(url);

  const porId = new Map<string, { nome: string; raw: RawInsightAcumulado }>();
  for (const r of rows) {
    porId.set(r.adset_id, { nome: r.adset_name, raw: parseRawInsight(r) });
  }

  const porNome = new Map<string, RawInsightAcumulado>();
  for (const { nome, raw } of porId.values()) {
    const atual = porNome.get(nome);
    porNome.set(nome, atual ? somarRawInsight(atual, raw) : raw);
  }

  return new Map([...porNome].map(([nome, raw]) => [nome, finalizarInsight(raw)]));
}

// Mesma coisa, mas level=ad — pedido do Rodrigo em 2026-09-28 pra poder ver investimento por
// CRIATIVO individual, não só o conjunto somado (essa parte vem direto do Meta, não depende do
// GA4/utm_content — diferente da tabela "Anúncios" acima, que é limitada ao nível de conjunto
// porque é isso que o link rastreado carrega).
type MetaAdInsightRow = {
  ad_id: string;
  ad_name: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  actions?: MetaAction[];
  purchase_roas?: MetaAction[];
};

// Mesma correção 2026-11-05 de getInsightsPorConjunto acima: agrega por `ad_id` (identidade real)
// antes de somar por `ad_name` — dois anúncios com o mesmo nome (ids diferentes) tinham seu
// insight sobrescrito silenciosamente pela versão anterior (`map.set(r.ad_name, ...)`).
export async function getInsightsPorAnuncio(range: { since: string; until: string }): Promise<Map<string, MetaInsight>> {
  const { accountId, accessToken } = getCredentials();
  const timeRange = encodeURIComponent(JSON.stringify(range));
  const fields = "ad_id,ad_name,spend,impressions,reach,clicks,actions,purchase_roas";
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${accountId}/insights?level=ad&fields=${fields}&time_range=${timeRange}&limit=500&access_token=${accessToken}`;
  const rows = await fetchAllPages<MetaAdInsightRow>(url);

  const porId = new Map<string, { nome: string; raw: RawInsightAcumulado }>();
  for (const r of rows) {
    porId.set(r.ad_id, { nome: r.ad_name, raw: parseRawInsight(r) });
  }

  const porNome = new Map<string, RawInsightAcumulado>();
  for (const { nome, raw } of porId.values()) {
    const atual = porNome.get(nome);
    porNome.set(nome, atual ? somarRawInsight(atual, raw) : raw);
  }

  return new Map([...porNome].map(([nome, raw]) => [nome, finalizarInsight(raw)]));
}

// Foto de cada anúncio/criativo individual (1 conta inteira, diferente de fetchFotosAtivas que é
// por conjunto) — cacheado com o mesmo padrão/janela de getFotosPorNomeConjunto, chave de cache
// separada pra não misturar os dois caches.
// `limit=500` (achado em 2026-10-01, auditoria de performance) estourava o pedido pro Graph API —
// erro real reproduzido 2x: "Please reduce the amount of data you're asking for". Como essa
// chamada ficava dentro do MESMO Promise.all de 4 chamadas (ver analytics-site/page.tsx), o erro
// derrubava as outras 3 junto (capturadas pelo catch silencioso) — a seção de Anúncios por
// criativo individual ficou sistematicamente quebrada em produção por isso. limit menor = páginas
// mais numerosas mas cada uma pequena o suficiente pra API aceitar (fetchAllPages já pagina certo).
// NÃO busca `creative{thumbnail_url}` aqui (achado em 2026-10-01, hardening de performance): essa
// expansão por anúncio é o que torna a chamada lenta (~15s pros ~500 ACTIVE+PAUSED da conta, vs
// ~3s pedindo só id/name/status) — e só getFotosPorNomeAnuncio precisa de foto, status não. Foto
// é buscada à parte, só pros poucos anúncios que batem nomesAnuncios (ver fetchCreativesPorIds).
async function fetchTodosAnuncios(): Promise<MetaAd[]> {
  const { accountId, accessToken } = getCredentials();
  // effective_status restringe a ACTIVE/PAUSED — testado em 2026-10-01: sem esse filtro, a conta
  // inteira (incluindo histórico arquivado/deletado de anos) levava ~31s pra paginar só nessa 1ª
  // chamada (cache-miss). Nada do que já é ARCHIVED/DELETED interessa aqui (status/foto exibidos
  // na tela só fazem sentido pra anúncio que ainda existe de verdade).
  const status = encodeURIComponent(JSON.stringify(["ACTIVE", "PAUSED"]));
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${accountId}/ads?fields=id,name,status&effective_status=${status}&limit=100&access_token=${accessToken}`;
  return fetchAllPages<MetaAd>(url);
}

// Busca creative só pros IDs pedidos (um GET por anúncio, não a conta inteira) — em vez de
// expandir creative pra conta inteira (caro, ~15s) só pra usar uma fração minúscula
// (nomesAnuncios tipicamente ~15 itens, o top por investimento). Mesmos dados exibidos de sempre
// (thumbnail_url), buscados de forma mais barata. Tentei primeiro o endpoint de lote (`?ids=`,
// 1 chamada só) — descoberto em 2026-10-01 que esse parâmetro está REMOVIDO pela Graph API
// ("ids query parameter is deprecated", erro 500 confirmado ao vivo, independente da versão
// pedida na URL). Concorrência limitada evita disparar 15 requests simultâneos de uma vez.
async function fetchCreativesPorIds(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { accessToken } = getCredentials();
  const CONCORRENCIA = 5;
  const fields = "creative{thumbnail_url,object_story_spec{video_data{image_url},link_data{picture}},asset_feed_spec{images}}";
  const map = new Map<string, string>();
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${id}?fields=${fields}&access_token=${accessToken}`;
      const res = await fetch(url);
      const json: { creative?: MetaCreative; error?: { message: string } } = await res.json();
      // Correção 2026-11-05: erro real da Graph API (token expirado, rate limit) virava "sem foto"
      // em silêncio — indistinguível de um anúncio que genuinamente não tem criativo.
      if (json.error) throw new Error(`Meta Ads API: ${json.error.message}`);
      const foto = extrairFoto(json.creative);
      if (foto) map.set(id, foto);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, ids.length) }, worker));
  return map;
}

// Mesmo racional de fetchAdSetsCached acima — getStatusPorNomeAnuncio e getFotosPorNomeAnuncio
// chamavam fetchTodosAnuncios() cada uma por conta própria.
const ANUNCIOS_CACHE_LABEL = "meta-ads-anuncios-raw";

async function fetchTodosAnunciosCached(prisma: PrismaClient): Promise<MetaAd[]> {
  const cached = await prisma.priceCatalogCache.findUnique({ where: { clientLabel: ANUNCIOS_CACHE_LABEL } });
  const isFresh = cached != null && Date.now() - cached.updatedAt.getTime() < FOTOS_MAX_AGE_HORAS * 60 * 60 * 1000;
  if (isFresh) return (cached!.data as unknown as MetaAd[]) ?? [];

  const fresh = await fetchTodosAnuncios();
  await prisma.priceCatalogCache.upsert({
    where: { clientLabel: ANUNCIOS_CACHE_LABEL },
    create: { clientLabel: ANUNCIOS_CACHE_LABEL, data: fresh as unknown as Prisma.InputJsonValue },
    update: { data: fresh as unknown as Prisma.InputJsonValue },
  });
  return fresh;
}

const CACHE_LABEL_CRIATIVO = "meta-ads-fotos-criativo";

export async function getFotosPorNomeAnuncio(
  prisma: PrismaClient,
  nomesAnuncios: string[]
): Promise<Map<string, string[]>> {
  const cached = await prisma.priceCatalogCache.findUnique({ where: { clientLabel: CACHE_LABEL_CRIATIVO } });
  const cachedData = (cached?.data as Record<string, string[]>) ?? {};
  const isFresh = cached != null && Date.now() - cached.updatedAt.getTime() < FOTOS_MAX_AGE_HORAS * 60 * 60 * 1000;

  const faltando = nomesAnuncios.filter((n) => !(n in cachedData));
  if (isFresh && faltando.length === 0) {
    return new Map(nomesAnuncios.map((n) => [n, cachedData[n] ?? []]));
  }

  // fetchTodosAnunciosCached não traz creative (ver comentário em fetchTodosAnuncios) — acha os
  // IDs de cada anúncio pelo nome, depois busca creative num lote só pra essa fração pequena.
  // Correção 2026-11-05: a versão anterior guardava só o PRIMEIRO id de cada nome
  // (`if (!idPorNome.has(a.name))`) — se dois anúncios reais (ids diferentes) tivessem o mesmo
  // nome, a foto do segundo nunca era buscada nem mostrada. Agora `idsPorNome` guarda TODOS os
  // ids de cada nome, e a foto final é a união das fotos de todos eles.
  const ads = await fetchTodosAnunciosCached(prisma);
  const idsPorNome = agruparPorNome(ads);
  const nomesParaBuscar = isFresh ? faltando : nomesAnuncios;
  const idsParaBuscar = nomesParaBuscar.flatMap((n) => (idsPorNome.get(n) ?? []).map((a) => a.id));
  const creativePorId = await fetchCreativesPorIds(idsParaBuscar);

  // Bug corrigido em 2026-10-13 (achado real em produção: Carrossel_Dinamico, Loja_Reels_Mai24 e
  // outros 5 apareciam "sem foto" mesmo a API do Meta devolvendo thumbnail_url válido pra eles).
  // A versão anterior escrevia em novosDados[nome] pra TODO nome em nomesAnuncios (a lista inteira
  // pedida nesta chamada, não só nomesParaBuscar/faltando) — como o Top 15 por gasto muda de
  // página em página (ranking desloca, novo criativo entra), toda vez que um nome NOVO entrava na
  // lista e caía no "isFresh && faltando não-vazio", o loop final zerava a foto de TODOS os outros
  // 14 nomes já corretos no cache (fotoPorNome só tinha dado pro nome novo, os outros viravam []).
  // Agora só escreve em novosDados pros nomes REALMENTE buscados agora — os demais mantêm o valor
  // já existente em cachedData (spread inicial), nunca voltam a [] só por terem ficado de fora do
  // lote desta chamada.
  const novosDados: Record<string, string[]> = { ...cachedData };
  for (const nome of nomesParaBuscar) {
    const ids = idsPorNome.get(nome) ?? [];
    novosDados[nome] = ids
      .map((a) => creativePorId.get(a.id))
      .filter((url): url is string => !!url);
  }

  await prisma.priceCatalogCache.upsert({
    where: { clientLabel: CACHE_LABEL_CRIATIVO },
    create: { clientLabel: CACHE_LABEL_CRIATIVO, data: novosDados },
    update: { data: novosDados },
  });

  return new Map(nomesAnuncios.map((n) => [n, novosDados[n] ?? []]));
}
