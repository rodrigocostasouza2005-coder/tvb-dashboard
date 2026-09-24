import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { todayBrasiliaStr, brasiliaDayStart, brasiliaDayEnd } from "@/lib/filters";
import {
  getKpiSummary,
  getMonthlySnapshotKpi,
  getSalesByDay,
  getSalesByDayPerStore,
  getSalesByDayPerColecao,
  getSalesByDimension,
  getSalesByStore,
  getSalesByGrupoProduto,
  getSalesByGrupoProdutoTamanho,
  getReturnsByGrupoProdutoTamanho,
  getSalesByTamanhoProduto,
  getSalesByProdutoTamanho,
  getReturnsByGrupoProduto,
  getReturnsByTamanhoProduto,
  getReturnsByProdutoTamanho,
  getGiftsByDimension,
  getGiftsByGrupoProduto,
  getReturnsByDimension,
  getReturnsByDay,
  getVendedorRanking,
  getMonthlySalesByStore,
  getDailySalesByProduto,
  getMonthlyReturnsTotal,
  getGiftsByCliente,
  getGiftsByDayByStore,
  getTopParaIncentivar,
  getSiteVarejoCidades,
  getReceitaHistoricaExterna,
  getDistribuicaoPedidos,
  getTopVendidosPorLoja,
  getVendasHojeComComparacao,
  getMaisVendidosSemana,
  getTicketPorFaixaMensal,
  getTamanhoMixMensal,
  DailyProdutoPoint,
  DistribuicaoPedidosItem,
} from "./vendas";
import {
  getTotalStock,
  getStockVsSalesCombinado,
  getStockVsSales,
  searchStockVsSales,
  searchStockVsSalesComTamanhos,
  getReplenishment,
  getReplenishmentPorVendas,
  getStockAging,
  getEstoqueAtual,
  getEstoqueAtualPorGrupoProduto,
  getEstoquePorArmazenador,
  getSugestoesRetiradaEstoque,
  getGradeTamanhoBusca,
  getMapaDeComprasDetalhado,
  setCoberturaMeta,
  getCrescimentoEsperado,
  setCrescimentoEsperado,
  getMinimumRules,
  getStockCoverage,
  StockVsSalesCombinadoRow,
  SugestaoRetirada,
  MesMapaCompras,
  MapaComprasProduto,
  MapaComprasGrupo,
} from "./estoque";
import {
  getSellthroughByColecao,
  getSellthroughColecaoDetalhe,
  getColecoes,
  getColecaoCurvaVida,
  CurvaVidaColecao,
} from "./sellthrough";
import {
  getPrimeiraVendaData,
  getNovosERecorrentesClientes,
  getTopClientes,
  getClienteTopMeses,
  getClientesCrmOverview,
  getClienteSegmentacao,
  getProdutosLiquidosPorClientes,
  getTamanhoEstoqueParaClientes,
  getClientesPrecoBehavior,
  getClientesPorDimensao,
  getCrossSellPorDimensao,
  getProdutosPortaDeEntrada,
  getClienteFicha,
  getAniversariantesDoMes,
  getClienteRetencaoPorMes,
  getClienteRetencaoVarejo,
  ClientesCrmOverview,
  ClienteSegmento,
  ClienteSegmentado,
  ClientePrecoBehavior,
  CrossSellResumo,
  CrossSellItem,
  CrossSellResult,
  ProdutoEntradaItem,
  ProdutosEntradaResult,
  ClienteFicha,
} from "./clientes";
import {
  getVendedoresAtivos,
  getSugestoesDeContato,
  getFollowUpPosCompra,
  getContatosPorVendedor,
  getVendedores,
  SugestaoContato,
  AtribuicaoInfo,
  FollowUpPosCompra,
  ContatoRealizado,
  ContatoPorVendedor,
} from "./contato-vendedor";
import {
  getAtacadoVendas,
  getAtacadoCidades,
  getAtacadoClientes,
  getAtacadoClienteNomes,
  getAtacadoClienteEvolucao,
  AtacadoClienteEvolucaoMes,
  AtacadoClienteEvolucaoProduto,
  AtacadoClienteEvolucao,
} from "./atacado";


export type Dimension = "grupo" | "produto" | "tamanho" | "colecao";

// Desconta devolução de linhas de venda já agrupadas por chave (produto/grupo/tamanho) — vira
// líquida. Usado onde o Rodrigo pediu explicitamente pra não mostrar bruta (Estoque × Vendas,
// Top mais/menos vendidos, em 2026-08-24). Some é feita fora daqui (getReturnsByDimension /
// getReturnsByGrupoProduto), essa função só junta e subtrai pela mesma chave.
export function netByReturns<T extends { key: string; unitsSold: number; revenue: number }>(
  sold: T[],
  returned: { key: string; unitsReturned: number; value: number }[]
): T[] {
  const retByKey = new Map(returned.map((r) => [r.key, r]));
  return sold.map((s) => {
    const r = retByKey.get(s.key);
    return {
      ...s,
      unitsSold: s.unitsSold - (r?.unitsReturned ?? 0),
      revenue: s.revenue - (r?.value ?? 0),
    };
  });
}

export type DashboardFilters = {
  storeIds?: string[];
  marcas?: string[];
  tabelasPreco?: string[];
  from: Date;
  to: Date;
  // Restringe a grupos específicos — usado pra aplicar a regra de permissão do VENDEDOR
  // (só vê grupos prioritários) em qualquer dimensão, não só quando agrupando por grupo.
  grupoIn?: string[];
  // Restringe a tamanhos específicos — filtro de Tamanho na aba Estoque x Vendas (pedido do
  // Rodrigo em 2026-09-01, mesma UX do filtro de Grupo).
  tamanhoIn?: string[];
  // Restringe a coleções específicas — filtro básico de Coleção. Return só passou a gravar
  // colecao em 2026-09-14 — returnWhere() trata null como "passa" pra não sumir com o histórico
  // antigo de devolução (ver comentário lá).
  colecaoIn?: string[];
};

export function returnWhere(filters: DashboardFilters): Prisma.ReturnWhereInput {
  // marca e tabelaPreco ainda não estão populados nos registros históricos de devolução
  // (backfill pendente) — filtrar por esses campos zeraria todas as devoluções. Por ora
  // só filtramos por loja, período e grupo (que já existiam antes).
  // colecao começou a ser gravada em 2026-09-14 (achado do Rodrigo: devolução de outra coleção
  // estava sendo descontada do líquido da coleção filtrada) — devoluções sincronizadas antes
  // disso ficam com colecao=null pra sempre, então o filtro passa null também (senão o histórico
  // inteiro de devolução sumiria assim que alguém filtrasse por coleção).
  return {
    returnDate: { gte: filters.from, lte: filters.to },
    ...(filters.storeIds !== undefined ? { storeId: { in: filters.storeIds } } : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
    ...(filters.tamanhoIn ? { tamanho: { in: filters.tamanhoIn } } : {}),
    ...(filters.colecaoIn ? { OR: [{ colecao: { in: filters.colecaoIn } }, { colecao: null }] } : {}),
  };
}

export function saleWhere(filters: DashboardFilters): Prisma.SaleWhereInput {
  return {
    saleDate: { gte: filters.from, lte: filters.to },
    ...(filters.storeIds !== undefined ? { storeId: { in: filters.storeIds } } : {}),
    ...(filters.marcas !== undefined ? { marca: { in: filters.marcas } } : {}),
    // tabelaPreco: inclui null (= registros antigos sem tabela inferida) junto com os valores
    // permitidos — null não é "tabela proibida", é só dado que ainda não foi preenchido.
    ...(filters.tabelasPreco !== undefined
      ? { OR: [{ tabelaPreco: { in: filters.tabelasPreco } }, { tabelaPreco: null }] }
      : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
    ...(filters.tamanhoIn ? { tamanho: { in: filters.tamanhoIn } } : {}),
    ...(filters.colecaoIn ? { colecao: { in: filters.colecaoIn } } : {}),
  };
}

export function stockWhere(
  filters: Pick<DashboardFilters, "storeIds" | "grupoIn" | "tamanhoIn" | "colecaoIn">
): Prisma.StockSnapshotWhereInput {
  return {
    // "(sem grupo)" é o que o sync grava quando o DAPIC não manda Grupo pra aquela linha —
    // na prática é sempre matéria-prima/insumo (etiqueta, zíper, tecido em rolo), nunca produto
    // de verdade à venda. Rodrigo pediu pra tirar do dashboard inteiro.
    grupo: { not: "(sem grupo)" },
    ...(filters.storeIds !== undefined ? { storeId: { in: filters.storeIds } } : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
    ...(filters.tamanhoIn ? { tamanho: { in: filters.tamanhoIn } } : {}),
    ...(filters.colecaoIn ? { colecao: { in: filters.colecaoIn } } : {}),
  };
}

export type Canal = "todos" | "b2b" | "b2c";

// B2B = Tabela atacado. Não existe um campo "canal" de verdade no DAPIC — tabelaPreco (inferida
// batendo o preço pago contra o catálogo, ver connectors/tabela-preco.ts) é o proxy mais próximo
// disponível, e por venda individual isso ainda vale (decisão do Rodrigo em 2026-08-21).
//
// MAS por CLIENTE a regra é outra desde 2026-09-01: cliente atacado de verdade costuma negociar
// preço próprio, então boa parte (às vezes toda) da venda dele nem bate com a tabela cadastrada e
// cai em tabelaPreco=null — que por padrão contaria como B2C, fazendo um cliente 100% atacado
// (achado real: GUARDERIA SURF CLUB LTDA) aparecer sempre como varejo. Por isso, pra filtrar por
// CLIENTE (Segmentação, Ficha, Sugestões de Contato etc — qualquer coisa agrupada por
// clienteNome), um cliente que já teve QUALQUER venda batendo exato com "Tabela atacado" alguma
// vez conta como B2B pra todo o histórico dele, inclusive as vendas com tabelaPreco null. Venda
// sem clienteNome (balcão/anônima) não tem como saber o cliente, então continua pela regra antiga
// (só a própria tabelaPreco da linha).
let b2bClientesCache: { set: Set<string>; expiresAt: number } | null = null;
const B2B_CLIENTES_CACHE_MS = 5 * 60 * 1000;

// Cache genérico com TTL, mesmo espírito do b2bClientesCache acima — achado em 2026-09-10:
// getClienteSegmentacao/getAniversariantesDoMes escaneiam o histórico de Sale inteiro (dezenas de
// milhares de linhas, sem índice pra isso) toda vez que são chamadas, o que deixava a aba
// Sugestões de Contato (que chama as duas) perto de 40s pra carregar. Nenhuma das duas precisa
// ser "ao vivo" (segmentação/aniversário não mudam minuto a minuto) — cacheia por instância de
// servidor (não sobrevive entre invocações serverless frias, mas ajuda muito em picos de uso).
const genericCache = new Map<string, { value: unknown; expiresAt: number }>();
export async function cacheAsync<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = genericCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await fn();
  genericCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}
export const HEAVY_QUERY_CACHE_MS = 15 * 60 * 1000;

export async function getB2BClienteNomes(): Promise<Set<string>> {
  if (b2bClientesCache && b2bClientesCache.expiresAt > Date.now()) return b2bClientesCache.set;
  const rows = await prisma.sale.findMany({
    where: { tabelaPreco: "Tabela atacado", clienteNome: { not: null } },
    select: { clienteNome: true },
    distinct: ["clienteNome"],
  });
  const set = new Set(rows.map((r) => r.clienteNome as string));
  b2bClientesCache = { set, expiresAt: Date.now() + B2B_CLIENTES_CACHE_MS };
  return set;
}

export async function canalWhere(canal: Canal): Promise<Prisma.SaleWhereInput> {
  if (canal === "todos") return {};
  const b2bClientes = [...(await getB2BClienteNomes())];
  if (canal === "b2b") {
    return { OR: [{ tabelaPreco: "Tabela atacado" }, { clienteNome: { in: b2bClientes } }] };
  }
  // "not: X" no Prisma exclui null (vira "<>" puro no SQL) — precisa do OR explícito com null,
  // senão toda venda sem tabelaPreco inferida (boa parte da base) sumia do B2C. Achado testando
  // contra dado real: sem isso, b2b + b2c não batia com "todos" (2731 vs 1667 unidades).
  return {
    AND: [
      { OR: [{ tabelaPreco: { not: "Tabela atacado" } }, { tabelaPreco: null }] },
      { OR: [{ clienteNome: null }, { clienteNome: { notIn: b2bClientes } }] },
    ],
  };
}

export function dimensionKey(dimension: Dimension, row: { grupo?: string; produto?: string; tamanho?: string | null; colecao?: string | null }) {
  const v = dimension === "grupo" ? row.grupo : dimension === "produto" ? row.produto : dimension === "tamanho" ? row.tamanho : row.colecao;
  return v && v.trim() ? v : "—";
}

// Última sync de estoque concluída com sucesso — pras integrações externas (MCP/GPT) saberem a
// defasagem real do dado, já que o sync roda ~5x/dia (crons em vercel.json), não em tempo real.
export async function getLastEstoqueSyncTime(): Promise<string | null> {
  const last = await prisma.syncLog.findFirst({
    where: { source: "STOCK", status: "SUCCESS" },
    orderBy: { finishedAt: "desc" },
  });
  return last?.finishedAt ? last.finishedAt.toISOString() : null;
}

// StockSnapshot tem 1 linha por storeId+cod (upsert no sync mantém sempre atualizada, ver
// upsertStockSnapshots) — não tem mais duplicata histórica pra dedupar aqui.
export async function latestStockSnapshots(filters: Pick<DashboardFilters, "storeIds" | "grupoIn" | "tamanhoIn" | "colecaoIn">) {
  return prisma.stockSnapshot.findMany({
    where: stockWhere(filters),
    select: {
      storeId: true,
      cod: true,
      grupo: true,
      produto: true,
      tamanho: true,
      colecao: true,
      quantidadeDisponivel: true,
      estoqueMinimo: true,
      valorCusto: true,
    },
  });
}

export function sortTamanhos(tamanhos: string[]) {
  return tamanhos.sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

export type StoreFilterOption = { id: string; name: string };

// Junta lojas com o mesmo displayGroup (ex: CD + ATACADO) numa única opção de filtro —
// o id vira "id1|id2", que parseFilters() expande de volta em vários storeId no where.
// Os dados por baixo continuam separados (evita somar/sobrescrever quantidade errado).
export function groupStoresForFilter(stores: { id: string; name: string; displayGroup: string | null }[]): StoreFilterOption[] {
  const groups = new Map<string, string[]>();
  const standalone: StoreFilterOption[] = [];

  for (const s of stores) {
    if (s.displayGroup) {
      const ids = groups.get(s.displayGroup) ?? [];
      ids.push(s.id);
      groups.set(s.displayGroup, ids);
    } else {
      standalone.push({ id: s.id, name: s.name });
    }
  }

  const grouped = [...groups.entries()].map(([name, ids]) => ({ id: ids.join("|"), name }));
  return [...grouped, ...standalone].sort((a, b) => a.name.localeCompare(b.name));
}

// Resolve um nome de loja/filial em texto livre (ex: "Rio Sul", "site e atacado") pro(s)
// storeId(s) correspondente(s) — usado pelas integrações externas (MCP do Claude, Actions do
// ChatGPT) pra permitir quebrar consulta por filial sem o chamador precisar saber o id interno.
// undefined = não filtrou (nome vazio/não informado); null = nome dado não bateu com loja
// nenhuma (chamador deve avisar e sugerir os nomes válidos, não seguir sem filtro).
export async function resolveLojaNome(loja: string | undefined | null): Promise<string[] | null | undefined> {
  if (!loja || !loja.trim()) return undefined;
  const stores = await getStores();
  const alvo = loja.trim().toLowerCase();
  const match = stores.find((s) => s.name.toLowerCase().includes(alvo));
  if (!match) return null;
  return match.id.split("|");
}

// allowedStoreIds: restrição por usuário (ver getStoreRestriction) — quando presente, nem
// aparece como opção pra escolher, não é só um filtro que já vem pré-marcado.
export async function getStores(allowedStoreIds?: string[]): Promise<StoreFilterOption[]> {
  const stores = await prisma.store.findMany({
    where: { sellsProducts: true, ...(allowedStoreIds ? { id: { in: allowedStoreIds } } : {}) },
    orderBy: { name: "asc" },
  });
  return groupStoresForFilter(stores);
}

// Todos os armazenadores, incluindo os que não são loja de venda (Defeito, Bonificação,
// Lixeira, Marketing/Produção) — usado no filtro da aba Estoque Atual.
export async function getAllStores(allowedStoreIds?: string[]): Promise<StoreFilterOption[]> {
  const stores = await prisma.store.findMany({
    where: allowedStoreIds ? { id: { in: allowedStoreIds } } : undefined,
    orderBy: { name: "asc" },
  });
  return groupStoresForFilter(stores);
}

// Lojas "cruas" (sem agrupar CD+ATACADO) — usado na tela de estoque mínimo, onde a regra
// precisa mirar o armazenador de verdade, não a opção agrupada do filtro.
export async function getRawStores() {
  return prisma.store.findMany({ orderBy: { name: "asc" } });
}

// IDs dos 2 armazenadores por trás de "TVB Site e Atacado" (CD + ATACADO) — usado em toda função
// que precisa achar venda de atacado (canalWhere("b2b")) por baixo do token cd-atacado. Achado
// em 2026-09-23: até então venda/devolução de atacado (faturas) e venda de site ficavam TODAS
// gravadas na loja CD; corrigido a sync pra separar por loja de verdade (ver sync-runner.ts). As
// funções de Atacado (getAtacadoVendas etc) e getClienteRetencaoPorMes ficaram hardcoded só em
// "storeId: cdStore.id" de uma época em que isso bastava — agora precisam olhar as 2 lojas juntas
// (a definição de "é atacado" continua sendo canalWhere("b2b"), não a loja em si — a loja só
// limita o universo de busca pro canal que pode ter atacado).
export async function getSiteAtacadoStoreIds(): Promise<string[]> {
  const stores = await prisma.store.findMany({ where: { code: { in: ["CD", "ATACADO"] } } });
  return stores.map((s) => s.id);
}

// Listas completas (não filtradas entre si) pra montar os dropdowns da tela de Estoque Mínimo —
// Rodrigo quer preencher via Tab, então nenhum campo pode ficar vazio/desabilitado esperando
// outro ser escolhido primeiro.
export async function getDistinctColecoes() {
  const rows = await prisma.stockSnapshot.findMany({
    distinct: ["colecao"],
    select: { colecao: true },
    where: { colecao: { not: null } },
  });
  return rows.map((r) => r.colecao as string).sort();
}

// Filtro de Tamanho na aba Estoque x Vendas — pedido do Rodrigo em 2026-09-01.
export async function getDistinctTamanhos() {
  const rows = await prisma.stockSnapshot.findMany({
    distinct: ["tamanho"],
    select: { tamanho: true },
    where: { tamanho: { not: null } },
  });
  return sortTamanhos(rows.map((r) => r.tamanho as string));
}

export async function getDistinctGrupos() {
  const rows = await prisma.stockSnapshot.findMany({
    distinct: ["grupo"],
    select: { grupo: true },
    where: { grupo: { not: "(sem grupo)" } },
  });
  return rows.map((r) => r.grupo).sort();
}

// Tamanhos que cada grupo realmente tem (camisa não tem 42, Classic não tem G/UNICO, etc) —
// usado pra filtrar o dropdown de Tamanho conforme o Grupo escolhido, na tela de Estoque Mínimo.
export async function getTamanhosPorGrupo() {
  const rows = await prisma.stockSnapshot.findMany({
    distinct: ["grupo", "tamanho"],
    select: { grupo: true, tamanho: true },
    where: { tamanho: { not: null }, grupo: { not: "(sem grupo)" } },
  });
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.grupo) ?? [];
    list.push(r.tamanho as string);
    map.set(r.grupo, list);
  }
  for (const list of map.values()) list.sort();
  return Object.fromEntries(map);
}

// allowedMarcas: restrição por usuário (ver getMarcaRestriction em lib/permissions.ts) —
// mesmo padrão de getStores(allowedStoreIds), trava de verdade (nem aparece como opção).
export async function getMarcas(allowedMarcas?: string[]) {
  const rows = await prisma.sale.findMany({
    distinct: ["marca"],
    select: { marca: true },
    where: { marca: { not: null, ...(allowedMarcas ? { in: allowedMarcas } : {}) } },
  });
  return rows.map((r) => r.marca as string).sort();
}

export async function getTabelasPreco(allowedTabelasPreco?: string[]) {
  const rows = await prisma.sale.findMany({
    distinct: ["tabelaPreco"],
    select: { tabelaPreco: true },
    where: { tabelaPreco: { not: null, ...(allowedTabelasPreco ? { in: allowedTabelasPreco } : {}) } },
  });
  return rows.map((r) => r.tabelaPreco as string).sort();
}

// Uma linha por fonte (Estoque, Vendas, Devoluções, Produção, Brinde), sempre a mais recente
// dela — antes pegava só as últimas 4 linhas no total, e como cada sync grava 5 linhas quase
// juntas, sempre cortava uma fonte fora (Estoque, por ser a primeira gravada no lote).
export async function getLastSyncs() {
  return prisma.syncLog.findMany({
    orderBy: { startedAt: "desc" },
    distinct: ["source"],
  });
}
