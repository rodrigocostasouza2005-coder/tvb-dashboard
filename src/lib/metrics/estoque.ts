import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { todayBrasiliaStr, brasiliaDayStart, brasiliaDayEnd } from "@/lib/filters";
import {
  netByReturns,
  returnWhere,
  saleWhere,
  stockWhere,
  cacheAsync,
  getB2BClienteNomes,
  canalWhere,
  dimensionKey,
  getLastEstoqueSyncTime,
  latestStockSnapshots,
  sortTamanhos,
  groupStoresForFilter,
  resolveLojaNome,
  getStores,
  getAllStores,
  getRawStores,
  getDistinctColecoes,
  getDistinctTamanhos,
  getDistinctGrupos,
  getTamanhosPorGrupo,
  getMarcas,
  getTabelasPreco,
  getLastSyncs,
  Dimension,
  DashboardFilters,
  Canal,
  StoreFilterOption,
  HEAVY_QUERY_CACHE_MS,
} from "./core";
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


// Pega o snapshot mais recente por loja+produto (evita somar duplicado se já tivermos
// vários syncs no histórico).
// Total de estoque atual sem filtro de data — usado para o card "Estoque atual" na aba
// Estoque × Vendas, onde a data filtra vendas mas não deve mudar o snapshot de estoque.
export async function getTotalStock(filters: Pick<DashboardFilters, "storeIds" | "grupoIn" | "tamanhoIn" | "colecaoIn">) {
  const result = await prisma.stockSnapshot.aggregate({
    where: stockWhere(filters),
    _sum: { quantidadeDisponivel: true },
  });
  return result._sum.quantidadeDisponivel ?? 0;
}

export type StockVsSalesCombinadoRow = {
  grupo: string;
  produto: string;
  tamanho: string;
  currentStock: number;
  unitsSold: number;
};

// Estoque × Vendas em granularidade máxima (grupo+produto+tamanho juntos, não 1 dimensão de
// cada vez) — pedido do Rodrigo em 2026-08-31 pra deixar a aba "dinâmica", parecida com o
// cross-filter do Power BI: o cliente busca essa lista UMA vez e filtra grupo→produto→tamanho
// inteiramente no navegador (sem round-trip), então precisa de todas as combinações de uma vez.
// Vendido já líquido (desconta devolução, mesmo padrão de netByReturns usado no resto da aba).
export async function getStockVsSalesCombinado(filters: DashboardFilters): Promise<StockVsSalesCombinadoRow[]> {
  const [salesRows, returnRows, stockRows] = await Promise.all([
    getSalesByGrupoProdutoTamanho(filters),
    getReturnsByGrupoProdutoTamanho(filters),
    latestStockSnapshots(filters),
  ]);

  const returnByKey = new Map<string, number>();
  for (const r of returnRows) {
    const key = `${r.grupo}::${r.produto}::${r.key}`;
    returnByKey.set(key, (returnByKey.get(key) ?? 0) + r.unitsReturned);
  }

  const stockByKey = new Map<string, number>();
  for (const s of stockRows) {
    const tamanho = s.tamanho && s.tamanho.trim() ? s.tamanho : "—";
    const key = `${s.grupo}::${s.produto}::${tamanho}`;
    stockByKey.set(key, (stockByKey.get(key) ?? 0) + s.quantidadeDisponivel);
  }

  const meta = new Map<string, { grupo: string; produto: string; tamanho: string }>();
  const salesByKey = new Map<string, number>();
  for (const s of salesRows) {
    const key = `${s.grupo}::${s.produto}::${s.key}`;
    meta.set(key, { grupo: s.grupo, produto: s.produto, tamanho: s.key });
    salesByKey.set(key, s.unitsSold);
  }
  for (const key of stockByKey.keys()) {
    if (!meta.has(key)) {
      const [grupo, produto, tamanho] = key.split("::");
      meta.set(key, { grupo, produto, tamanho });
    }
  }

  return [...meta.entries()].map(([key, m]) => ({
    grupo: m.grupo,
    produto: m.produto,
    tamanho: m.tamanho,
    currentStock: stockByKey.get(key) ?? 0,
    unitsSold: (salesByKey.get(key) ?? 0) - (returnByKey.get(key) ?? 0),
  }));
}

// Soma de quantidade produzida (ProductionOrder) por dimensão — mesmo agrupamento usado pra
// vendas/estoque. Não filtra por loja (produção não é por loja, é centralizada na Matriz).
async function getProductionByDimension(
  filters: Pick<DashboardFilters, "marcas" | "grupoIn">,
  dimension: Dimension
) {
  const where: Prisma.ProductionOrderWhereInput = {
    ...(filters.marcas !== undefined ? { marca: { in: filters.marcas } } : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
  };
  const by = dimension === "grupo" ? "grupo" : dimension === "produto" ? "produto" : dimension === "tamanho" ? "tamanho" : "colecao";
  const rows = await prisma.productionOrder.groupBy({ by: [by], where, _sum: { quantidade: true } });
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = dimensionKey(dimension, { [by]: (r as unknown as Record<string, string | null>)[by] });
    map.set(key, (map.get(key) ?? 0) + (r._sum.quantidade ?? 0));
  }
  return map;
}

// Sell-through preferencialmente por vendido/produzido (mais correto — "produzido" é o total
// real que entrou no pipeline, "estoque atual" é só uma aproximação por não ter perdas/amostras/
// brindes fora da conta). Só usa produzido quando o número faz sentido (>= vendido) — como o
// histórico de ordem de produção só existe desde 2025-08-22, ~26% dos SKUs não têm registro
// nenhum e outros têm só o último lote de reposição (produzido < vendido histórico nesses casos,
// o que daria sell-through impossível tipo 800%). Nesses casos cai pro cálculo antigo. Pedido do
// Rodrigo em 2026-08-11 depois de eu mostrar os números reais de cobertura/inconsistência.
export function resolveSellThrough(unitsSoldAllTime: number, currentStock: number, produzido: number) {
  if (produzido > 0 && produzido >= unitsSoldAllTime) {
    return Math.min((unitsSoldAllTime / produzido) * 100, 100);
  }
  return unitsSoldAllTime + currentStock > 0
    ? (unitsSoldAllTime / (unitsSoldAllTime + currentStock)) * 100
    : null;
}

export async function getStockVsSales(filters: DashboardFilters, dimension: Dimension = "grupo") {
  // Sell-through é uma métrica da EMPRESA INTEIRA, não da loja filtrada — não deve mudar nem
  // com o filtro de data (Rodrigo notou isso em 2026-08-10) nem com o filtro de loja (achado
  // em 2026-08-12: ele quer o mesmo número não importa qual loja esteja selecionada). Só
  // "vendido no período", "estoque atual" e giro (as outras colunas) respeitam os filtros.
  const allTimeFilters: DashboardFilters = { ...filters, from: new Date(0), to: new Date() };
  const empresaToda: DashboardFilters = { ...allTimeFilters, storeIds: undefined };

  const [sales, salesAllTime, stock, salesEmpresaToda, stockEmpresaToda, producedByKey] = await Promise.all([
    getSalesByDimension(filters, dimension),
    getSalesByDimension(allTimeFilters, dimension),
    latestStockSnapshots(filters),
    getSalesByDimension(empresaToda, dimension),
    latestStockSnapshots(empresaToda),
    getProductionByDimension(filters, dimension),
  ]);
  const soldAllTimeByKey = new Map(salesAllTime.map((s) => [s.key, s.unitsSold]));
  const soldEmpresaTodaByKey = new Map(salesEmpresaToda.map((s) => [s.key, s.unitsSold]));

  const stockByKey = new Map<string, number>();
  for (const s of stock) {
    const key = dimensionKey(dimension, s);
    stockByKey.set(key, (stockByKey.get(key) ?? 0) + s.quantidadeDisponivel);
  }
  const stockEmpresaTodaByKey = new Map<string, number>();
  for (const s of stockEmpresaToda) {
    const key = dimensionKey(dimension, s);
    stockEmpresaTodaByKey.set(key, (stockEmpresaTodaByKey.get(key) ?? 0) + s.quantidadeDisponivel);
  }

  const keys = new Set([...sales.map((s) => s.key), ...stockByKey.keys()]);

  return [...keys]
    .map((key) => {
      const sale = sales.find((s) => s.key === key);
      const unitsSold = sale?.unitsSold ?? 0;
      const revenue = sale?.revenue ?? 0;
      const currentStock = stockByKey.get(key) ?? 0;
      const sellThroughRate = resolveSellThrough(
        soldEmpresaTodaByKey.get(key) ?? 0,
        stockEmpresaTodaByKey.get(key) ?? 0,
        producedByKey.get(key) ?? 0
      );
      // Aproximação: sem série histórica de estoque ainda, usamos o snapshot atual como
      // "estoque médio" do período. Melhora sozinho conforme o /api/sync acumular snapshots.
      const inventoryTurnover = currentStock > 0 ? unitsSold / currentStock : null;
      return { key, unitsSold, revenue, currentStock, sellThroughRate, inventoryTurnover };
    })
    .sort((a, b) => b.unitsSold - a.unitsSold);
}

export async function searchStockVsSales(
  filters: DashboardFilters,
  dimension: Dimension,
  query: string
) {
  const all = await getStockVsSales(filters, dimension);
  if (!query.trim()) return all;
  const q = query.trim().toLowerCase();
  return all.filter((r) => r.key.toLowerCase().includes(q));
}

// Pesquisa sempre por produto, com o estoque aberto por tamanho na mesma linha (pedido do
// Rodrigo em 2026-08-12 — antes a aba tinha um seletor Grupo/Produto/Tamanho, mas ele queria ver
// o produto com os tamanhos lado a lado, não trocar de visão). "Total" da quebra por tamanho é a
// mesma soma que currentStock já mostrava — não é outro número, só decomposto.
export async function searchStockVsSalesComTamanhos(filters: DashboardFilters, query: string) {
  const queryTrim = query.trim();
  // getStockVsSales calculado 1x só (era 2x — uma vez pro nome, outra pro tamanho — dobrando o
  // tempo de resposta à toa; achado pelo Rodrigo reclamando que a busca ficou lenta em
  // 2026-09-02). Filtra o resultado já calculado em memória, tanto por nome quanto por tamanho.
  const all = await getStockVsSales(filters, "produto");

  let rows = all;
  if (queryTrim) {
    const q = queryTrim.toLowerCase();
    const porChave = new Set(all.filter((r) => r.key.toLowerCase().includes(q)).map((r) => r.key));

    // Se o texto digitado bate com um tamanho de verdade (ex: "42", "GG"), também traz produtos
    // que TÊM esse tamanho, mesmo que o nome não bata — pedido do Rodrigo em 2026-09-02.
    // quantidadeDisponivel > 0 — sem isso trazia produto com esse tamanho zerado (a linha
    // existe no StockSnapshot mesmo sem estoque, ver Sugestão de Retirada). Rodrigo quer só o
    // que TEM de verdade nesse tamanho.
    const comEsseTamanho = await prisma.stockSnapshot.findMany({
      where: { ...stockWhere(filters), tamanho: { equals: queryTrim, mode: "insensitive" }, quantidadeDisponivel: { gt: 0 } },
      select: { produto: true },
      distinct: ["produto"],
    });
    for (const r of comEsseTamanho) porChave.add(r.produto);

    rows = all.filter((r) => porChave.has(r.key));
  }
  if (rows.length === 0) return { rows: [], tamanhos: [] as string[] };

  const produtoNames = rows.map((r) => r.key);

  // Só lojas de venda de verdade (não armazéns tipo Defeito/Lixeira/Marketing) — "quanto tem
  // nas lojas" quer dizer ponto de venda, não todo armazenador. Junta por displayGroup igual
  // o filtro de loja já faz (TVB Site e Atacado vira uma linha só), senão contaria a mesma
  // operação duas vezes.
  const sellingStores = await prisma.store.findMany({ where: { sellsProducts: true } });
  const lojaNameByStoreId = new Map(sellingStores.map((s) => [s.id, s.displayGroup ?? s.name]));

  const [stockRows, stockPorLojaRows] = await Promise.all([
    prisma.stockSnapshot.groupBy({
      by: ["produto", "tamanho"],
      where: { ...stockWhere(filters), produto: { in: produtoNames } },
      _sum: { quantidadeDisponivel: true },
    }),
    prisma.stockSnapshot.groupBy({
      by: ["produto", "storeId", "tamanho"],
      where: { ...stockWhere(filters), produto: { in: produtoNames }, storeId: { in: [...lojaNameByStoreId.keys()] } },
      _sum: { quantidadeDisponivel: true },
    }),
  ]);

  const tamanhoSet = new Set<string>();
  const porProdutoTamanho = new Map<string, Map<string, number>>();
  for (const s of stockRows) {
    const tamanho = s.tamanho && s.tamanho.trim() ? s.tamanho : "—";
    tamanhoSet.add(tamanho);
    const map = porProdutoTamanho.get(s.produto) ?? new Map<string, number>();
    map.set(tamanho, (map.get(tamanho) ?? 0) + (s._sum.quantidadeDisponivel ?? 0));
    porProdutoTamanho.set(s.produto, map);
  }

  // Loja -> tamanho -> quantidade, pra abrir o dropdown da Pesquisa mostrando os dois eixos
  // juntos (não só o total da loja) — pedido do Rodrigo depois de ver a primeira versão só com total.
  const porProdutoLoja = new Map<string, Map<string, Map<string, number>>>();
  for (const s of stockPorLojaRows) {
    const lojaNome = lojaNameByStoreId.get(s.storeId);
    if (!lojaNome) continue;
    const tamanho = s.tamanho && s.tamanho.trim() ? s.tamanho : "—";
    const porLoja = porProdutoLoja.get(s.produto) ?? new Map<string, Map<string, number>>();
    const porTamanho = porLoja.get(lojaNome) ?? new Map<string, number>();
    porTamanho.set(tamanho, (porTamanho.get(tamanho) ?? 0) + (s._sum.quantidadeDisponivel ?? 0));
    porLoja.set(lojaNome, porTamanho);
    porProdutoLoja.set(s.produto, porLoja);
  }

  const tamanhos = sortTamanhos([...tamanhoSet]);
  const rowsComTamanhos = rows.map((r) => ({
    ...r,
    porTamanho: porProdutoTamanho.get(r.key) ?? new Map<string, number>(),
    porLoja: porProdutoLoja.get(r.key) ?? new Map<string, Map<string, number>>(),
  }));

  return { rows: rowsComTamanhos, tamanhos };
}

// Acha a regra de mínimo manual mais específica (com coleção bate antes da genérica).
function matchMinimumRule(
  rules: { storeId: string; grupo: string; tamanho: string; colecao: string | null; valorMinimo: number }[],
  s: { storeId: string; grupo: string; tamanho: string | null; colecao: string | null }
): number | null {
  const exact = rules.find(
    (r) => r.storeId === s.storeId && r.grupo === s.grupo && r.tamanho === s.tamanho && r.colecao === s.colecao
  );
  if (exact) return exact.valorMinimo;
  const generic = rules.find(
    (r) => r.storeId === s.storeId && r.grupo === s.grupo && r.tamanho === s.tamanho && r.colecao === null
  );
  return generic?.valorMinimo ?? null;
}

export async function getReplenishment(filters: Pick<DashboardFilters, "storeIds" | "grupoIn"> & { colecaoIn?: string[] }) {
  // Busca tudo em paralelo para reduzir round-trips e evitar P1017 no Neon.
  const [stockAll, minimumRules, allStores] = await Promise.all([
    latestStockSnapshots(filters),
    prisma.stockMinimumRule.findMany(),
    prisma.store.findMany(),
  ]);
  // Filtro de coleção é pós-fetch (StockSnapshot já vem com colecao selecionado) — evita
  // mexer em stockWhere(), que é usado em vários outros lugares sem esse conceito.
  const stock = filters.colecaoIn?.length ? stockAll.filter((s) => s.colecao && filters.colecaoIn!.includes(s.colecao)) : stockAll;
  const storeName = new Map(allStores.map((s) => [s.id, s.name]));

  // A reposição sempre vem do centro de distribuição ("CD" / TVB Site e Atacado).
  const cdStore = allStores.find((s) => s.code === "CD") ?? null;
  const cdStockByCod = new Map<string, number>();
  if (cdStore) {
    const cdStock = await latestStockSnapshots({ storeIds: [cdStore.id] });
    for (const s of cdStock) cdStockByCod.set(s.cod, s.quantidadeDisponivel);
  }

  return stock
    .map((s) => {
      // Regra manual do Rodrigo ganha do estoqueMinimo que vem do DAPIC.
      const estoqueMinimo = matchMinimumRule(minimumRules, s) ?? s.estoqueMinimo;
      return { ...s, estoqueMinimo };
    })
    .filter(
      (s) =>
        s.estoqueMinimo != null &&
        s.quantidadeDisponivel < s.estoqueMinimo &&
        (!cdStore || s.storeId !== cdStore.id) &&
        // Menos de 4 unidades na origem = não compensa repor agora.
        (cdStockByCod.get(s.cod) ?? 0) > 3
    )
    .map((s) => {
      const estoqueNaOrigem = cdStockByCod.get(s.cod) ?? 0;
      // Nunca zera o CD (pedido do Rodrigo em 2026-09-15) — o teto é o estoque do CD menos 1,
      // não o estoque do CD inteiro, então sempre sobra pelo menos 1 unidade lá.
      const tetoSemZerarCD = Math.max(estoqueNaOrigem - 1, 0);
      return {
        storeId: s.storeId,
        storeName: storeName.get(s.storeId) ?? s.storeId,
        produto: s.produto,
        grupo: s.grupo,
        colecao: s.colecao,
        tamanho: s.tamanho,
        quantidadeDisponivel: s.quantidadeDisponivel,
        estoqueMinimo: s.estoqueMinimo as number,
        falta: Math.min((s.estoqueMinimo as number) - s.quantidadeDisponivel, tetoSemZerarCD),
        origemSugerida: cdStore?.name ?? "—",
        estoqueNaOrigem,
      };
    })
    // Por loja primeiro, depois produto em ordem alfabética (pedido do Rodrigo em 2026-09-15).
    .sort((a, b) => a.storeName.localeCompare(b.storeName) || a.produto.localeCompare(b.produto, "pt-BR"));
}

// Modo "Vendas" da tela de Reposição (2026-09-15, pedido do Rodrigo) — NÃO mexe em
// getReplenishment acima, que continua sendo o modo "Estoque Mínimo" de sempre, inalterado.
// Histórico de ajustes nessa mesma sessão, cada um corrigindo um ponto cego real que o Rodrigo
// achou testando:
// 1) Versão original: "dias de cobertura" com o mínimo como referência extra.
// 2) Simplificado pra: só venda da semana anterior (7 dias) × estoque atual.
// 3) Exceção pro item zerado sem venda na semana (usa o mínimo, senão nunca mais reaparece).
// 4) Mínimo vira piso quando o CD tem folga ("Treko Reverso" sugerindo só 1, achou pouco).
// 5) **2026-09-16**: Rodrigo revisou o resultado depois de rodar um tempo e achou que 71% das
//    sugestões vinham da exceção do mínimo (item zerado), não de giro real — a janela de 7 dias
//    corridos é amostra pequena demais pra produto que vende devagar mas de forma constante (só
//    não vendeu NAQUELA semana específica por acaso). Trocado pra **média semanal calculada
//    sobre as últimas 8 semanas (56 dias)** em vez do literal "última semana" — suaviza semana
//    atípica sem diluir uma mudança real de ritmo, e faz a exceção do mínimo disparar só pra
//    quem realmente não vende há ~2 meses, não por azar de 1 semana.
export async function getReplenishmentPorVendas(
  filters: Pick<DashboardFilters, "storeIds" | "grupoIn"> & { colecaoIn?: string[] }
) {
  const [stockAll, minimumRules, allStores] = await Promise.all([
    latestStockSnapshots(filters),
    prisma.stockMinimumRule.findMany(),
    prisma.store.findMany(),
  ]);
  const stock = filters.colecaoIn?.length ? stockAll.filter((s) => s.colecao && filters.colecaoIn!.includes(s.colecao)) : stockAll;
  const storeName = new Map(allStores.map((s) => [s.id, s.name]));

  const cdStore = allStores.find((s) => s.code === "CD") ?? null;
  const cdStockByCod = new Map<string, number>();
  if (cdStore) {
    const cdStock = await latestStockSnapshots({ storeIds: [cdStore.id] });
    for (const s of cdStock) cdStockByCod.set(s.cod, s.quantidadeDisponivel);
  }

  // Mesmo piso de "não compensa repor agora" do modo Estoque Mínimo (menos de 4 unidades na
  // origem), aplicado antes de buscar vendas pra não gastar query com quem não vai aparecer.
  const candidatos = stock.filter((s) => (!cdStore || s.storeId !== cdStore.id) && (cdStockByCod.get(s.cod) ?? 0) > 3);
  if (candidatos.length === 0) return [];

  const storeIds = [...new Set(candidatos.map((s) => s.storeId))];
  const cods = [...new Set(candidatos.map((s) => s.cod))];

  // Janela de giro = últimas 8 semanas (56 dias) corridas até agora — não usa o filtro de Data da
  // tela (esse modo não expõe mais esse filtro).
  const JANELA_GIRO_SEMANAS = 8;
  const to = new Date();
  const from = new Date(to.getTime() - JANELA_GIRO_SEMANAS * 7 * 86400000);

  const saleAgg = await prisma.sale.groupBy({
    by: ["storeId", "cod"],
    where: { storeId: { in: storeIds }, cod: { in: cods }, saleDate: { gte: from, lte: to } },
    _sum: { quantidade: true },
  });
  const vendasByKey = new Map(saleAgg.map((s) => [`${s.storeId}::${s.cod}`, s._sum.quantidade ?? 0]));

  return candidatos
    .map((s) => {
      const estoqueNaOrigem = cdStockByCod.get(s.cod) ?? 0;
      const vendasNoPeriodo = vendasByKey.get(`${s.storeId}::${s.cod}`) ?? 0;
      const mediaVendaSemanal = vendasNoPeriodo / JANELA_GIRO_SEMANAS;
      // Só é "sem dado confiável pra medir demanda" quando também está zerado — item com 5
      // unidades em estoque que não vendeu em 8 semanas não é falta de estoque pra vender, é
      // falta de demanda mesmo, não deveria repor (bug introduzido na reescrita de 2026-09-16,
      // achado pelo Rodrigo: "Boné Atlantico" na Barra tinha 5 em estoque, vendeu 0, e mesmo
      // assim pedia repor 5 só porque o mínimo era maior).
      const semGiroNoPeriodo = vendasNoPeriodo === 0 && s.quantidadeDisponivel === 0;
      const precisaReporPelaVenda = mediaVendaSemanal > s.quantidadeDisponivel;

      const estoqueMinimo = matchMinimumRule(minimumRules, s) ?? s.estoqueMinimo;
      const necessidadeMinimo = estoqueMinimo != null ? estoqueMinimo - s.quantidadeDisponivel : null;

      // Nunca zera o CD (pedido do Rodrigo em 2026-09-15) — o teto é o estoque do CD menos 1.
      const tetoSemZerarCD = Math.max(estoqueNaOrigem - 1, 0);
      // "CD tem de sobra" = dá pra cobrir o mínimo cadastrado inteiro sem chegar perto do teto.
      const cdTemDeSobra = necessidadeMinimo != null && necessidadeMinimo > 0 && tetoSemZerarCD >= necessidadeMinimo;

      let precisaRepor: boolean;
      let necessidade: number;
      if (semGiroNoPeriodo) {
        // Não vendeu NADA em 8 semanas — sem dado de venda confiável pra basear a conta. Só
        // repõe se existir mínimo cadastrado e o CD aguentar cobrir ele inteiro.
        precisaRepor = cdTemDeSobra;
        necessidade = necessidadeMinimo ?? 0;
      } else if (precisaReporPelaVenda) {
        precisaRepor = true;
        // CD com folga e mínimo pedindo mais que o ritmo médio de venda? Usa o mínimo (pedido do
        // Rodrigo: "se tiver muito em estoque, vale a pena colocar o mínimo"). Senão, só a venda.
        necessidade =
          cdTemDeSobra && necessidadeMinimo !== null
            ? Math.max(mediaVendaSemanal - s.quantidadeDisponivel, necessidadeMinimo)
            : mediaVendaSemanal - s.quantidadeDisponivel;
      } else {
        precisaRepor = false;
        necessidade = 0;
      }

      const falta = precisaRepor ? Math.min(Math.max(Math.ceil(necessidade), 1), tetoSemZerarCD) : 0;

      return {
        storeId: s.storeId,
        storeName: storeName.get(s.storeId) ?? s.storeId,
        produto: s.produto,
        grupo: s.grupo,
        colecao: s.colecao,
        tamanho: s.tamanho,
        quantidadeDisponivel: s.quantidadeDisponivel,
        vendasNoPeriodo,
        mediaVendaSemanal: Math.round(mediaVendaSemanal * 10) / 10,
        semGiroNoPeriodo,
        falta,
        precisaRepor,
        origemSugerida: cdStore?.name ?? "—",
        estoqueNaOrigem,
      };
    })
    .filter((r) => r.precisaRepor)
    // Por loja primeiro, depois produto em ordem alfabética (pedido do Rodrigo em 2026-09-15).
    .sort((a, b) => a.storeName.localeCompare(b.storeName) || a.produto.localeCompare(b.produto, "pt-BR"));
}

// Envelhecimento de estoque: pra cada item com estoque > 0, olha o histórico TODO de vendas
// (não só o período filtrado) pra achar a primeira e a última venda daquele produto naquela
// loja. "Dias desde a 1ª venda" é o sinal principal pedido pelo Rodrigo — mostra desde quando
// aquele produto realmente começou a vender, não só se parou de vender recentemente.
export async function getStockAging(
  filters: Pick<DashboardFilters, "storeIds" | "grupoIn" | "tabelasPreco">
) {
  const stock = (await latestStockSnapshots(filters)).filter((s) => s.quantidadeDisponivel > 0);
  if (stock.length === 0) return [];

  const storeIds = [...new Set(stock.map((s) => s.storeId))];
  const cods = [...new Set(stock.map((s) => s.cod))];

  // Sell-through é da empresa inteira, não da loja da linha (mesmo motivo do getStockVsSales,
  // ver comentário lá) — soma vendido/estoque por SKU (cod) em TODAS as lojas, ignorando o
  // storeId da linha. "Estoque disponível" continua sendo o da loja específica (isso sim é por
  // loja de propósito, é a coluna que mostra o que tem parado ali).
  const [saleAgg, saleAggEmpresaToda, stockEmpresaToda, producedAgg, stores] = await Promise.all([
    prisma.sale.groupBy({
      by: ["storeId", "cod"],
      where: {
        storeId: { in: storeIds },
        cod: { in: cods },
        ...(filters.tabelasPreco !== undefined ? { tabelaPreco: { in: filters.tabelasPreco } } : {}),
      },
      _min: { saleDate: true },
      _max: { saleDate: true },
      _sum: { quantidade: true },
    }),
    prisma.sale.groupBy({
      by: ["cod"],
      where: {
        cod: { in: cods },
        ...(filters.tabelasPreco !== undefined ? { tabelaPreco: { in: filters.tabelasPreco } } : {}),
      },
      _sum: { quantidade: true },
    }),
    latestStockSnapshots({ grupoIn: filters.grupoIn }),
    prisma.productionOrder.groupBy({ by: ["cod"], where: { cod: { in: cods } }, _sum: { quantidade: true } }),
    prisma.store.findMany({ where: { id: { in: storeIds } } }),
  ]);

  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const saleByKey = new Map(saleAgg.map((s) => [`${s.storeId}::${s.cod}`, s]));
  const vendidoEmpresaTodaByCod = new Map(saleAggEmpresaToda.map((s) => [s.cod, s._sum.quantidade ?? 0]));
  const produzidoByCod = new Map(producedAgg.map((p) => [p.cod, p._sum.quantidade ?? 0]));
  const estoqueEmpresaTodaByCod = new Map<string, number>();
  for (const s of stockEmpresaToda) {
    estoqueEmpresaTodaByCod.set(s.cod, (estoqueEmpresaTodaByCod.get(s.cod) ?? 0) + s.quantidadeDisponivel);
  }

  const today = new Date();
  const daysSince = (d: Date | null | undefined) =>
    d ? Math.floor((today.getTime() - d.getTime()) / 86_400_000) : null;

  return stock
    .map((s) => {
      const sale = saleByKey.get(`${s.storeId}::${s.cod}`);
      const primeiraVenda = sale?._min.saleDate ?? null;
      const ultimaVenda = sale?._max.saleDate ?? null;
      const totalVendido = sale?._sum.quantidade ?? 0;
      const sellThroughRate = resolveSellThrough(
        vendidoEmpresaTodaByCod.get(s.cod) ?? 0,
        estoqueEmpresaTodaByCod.get(s.cod) ?? 0,
        produzidoByCod.get(s.cod) ?? 0
      );
      return {
        storeName: storeName.get(s.storeId) ?? s.storeId,
        produto: s.produto,
        grupo: s.grupo,
        colecao: s.colecao ?? null,
        tamanho: s.tamanho,
        quantidadeDisponivel: s.quantidadeDisponivel,
        primeiraVenda,
        ultimaVenda,
        diasDesdePrimeiraVenda: daysSince(primeiraVenda),
        diasDesdeUltimaVenda: daysSince(ultimaVenda),
        totalVendido,
        sellThroughRate,
      };
    })
    .sort((a, b) => (b.diasDesdePrimeiraVenda ?? 999999) - (a.diasDesdePrimeiraVenda ?? 999999));
}

// Preço de tabela "Tabela varejo" por cod (IdGradeProduto), pro valor de venda estimado do
// estoque na aba Estoque Atual (pedido do Rodrigo em 2026-09-08: preço de venda varejo do lado
// do de custo). Reaproveita o PriceCatalogCache já mantido pelo sync (ver
// connectors/tabela-preco.ts) — o preço de cada tabela é o mesmo catálogo nacional independente
// de qual loja fez a sync, confirmado comparando "cd-atacado" com "leblon" pro mesmo cod. Usa
// "cd-atacado" por ser o cache mais completo (site+atacado enxerga todas as tabelas).
let varejoPriceMapCache: { at: number; map: Map<string, number> } | null = null;
const VAREJO_PRICE_CACHE_MS = 5 * 60 * 1000;

export async function getVarejoPriceMap(): Promise<Map<string, number>> {
  if (varejoPriceMapCache && Date.now() - varejoPriceMapCache.at < VAREJO_PRICE_CACHE_MS) {
    return varejoPriceMapCache.map;
  }
  const cache =
    (await prisma.priceCatalogCache.findUnique({ where: { clientLabel: "cd-atacado" } })) ??
    (await prisma.priceCatalogCache.findFirst());
  const map = new Map<string, number>();
  if (cache) {
    const data = cache.data as Record<string, { table: string; valor: number }[]>;
    for (const [cod, options] of Object.entries(data)) {
      const varejo = options.find((o) => o.table === "Tabela varejo");
      if (varejo) map.set(cod, varejo.valor);
    }
  }
  varejoPriceMapCache = { at: Date.now(), map };
  return map;
}

export async function getEstoqueAtual(filters: Pick<DashboardFilters, "storeIds" | "grupoIn">, dimension: Dimension) {
  const [stock, varejoPrices] = await Promise.all([latestStockSnapshots(filters), getVarejoPriceMap()]);

  const byKey = new Map<string, { quantidade: number; valorCusto: number; valorVenda: number }>();
  for (const s of stock) {
    const key = dimensionKey(dimension, s);
    const acc = byKey.get(key) ?? { quantidade: 0, valorCusto: 0, valorVenda: 0 };
    acc.quantidade += s.quantidadeDisponivel;
    acc.valorCusto += (s.valorCusto ?? 0) * s.quantidadeDisponivel;
    acc.valorVenda += (varejoPrices.get(s.cod) ?? 0) * s.quantidadeDisponivel;
    byKey.set(key, acc);
  }

  return [...byKey.entries()]
    .map(([key, v]) => ({ key, quantidade: v.quantidade, valorCusto: v.valorCusto, valorVenda: v.valorVenda }))
    .sort((a, b) => b.quantidade - a.quantidade);
}

// Produtos dentro de cada grupo — usado pra expandir um grupo na aba Estoque Atual,
// igual ao padrão getSalesByGrupoProduto/getGiftsByGrupoProduto.
export async function getEstoqueAtualPorGrupoProduto(filters: Pick<DashboardFilters, "storeIds" | "grupoIn">) {
  const [stock, varejoPrices] = await Promise.all([latestStockSnapshots(filters), getVarejoPriceMap()]);
  // Chave composta separada — evita depender de split de string no nome do produto.
  const byKey = new Map<string, { grupo: string; produto: string; quantidade: number; valorCusto: number; valorVenda: number }>();
  for (const s of stock) {
    const mapKey = `${s.grupo}\x00${s.produto}`;
    const acc = byKey.get(mapKey) ?? { grupo: s.grupo, produto: s.produto, quantidade: 0, valorCusto: 0, valorVenda: 0 };
    acc.quantidade += s.quantidadeDisponivel;
    acc.valorCusto += (s.valorCusto ?? 0) * s.quantidadeDisponivel;
    acc.valorVenda += (varejoPrices.get(s.cod) ?? 0) * s.quantidadeDisponivel;
    byKey.set(mapKey, acc);
  }
  return [...byKey.values()]
    .map((v) => ({ grupo: v.grupo, key: v.produto, quantidade: v.quantidade, valorCusto: v.valorCusto, valorVenda: v.valorVenda }))
    .sort((a, b) => b.quantidade - a.quantidade);
}

// Distribuição de estoque por armazenador — pra gráfico de pizza (% de peças por loja/armazém).
// Respeita o mesmo filtro de Loja do topo da página (storeIds) — antes ignorava e sempre
// mostrava todo mundo, mesmo filtrando a tabela abaixo.
export async function getEstoquePorArmazenador(filters: Pick<DashboardFilters, "storeIds" | "grupoIn"> = {}) {
  const stock = await latestStockSnapshots(filters);
  const stores = await prisma.store.findMany();
  const storeName = new Map(stores.map((s) => [s.id, s.name]));

  const byStore = new Map<string, number>();
  for (const s of stock) {
    const name = storeName.get(s.storeId) ?? s.storeId;
    byStore.set(name, (byStore.get(name) ?? 0) + s.quantidadeDisponivel);
  }

  const total = [...byStore.values()].reduce((sum, v) => sum + v, 0);
  return [...byStore.entries()]
    .map(([storeName, quantidade]) => ({
      storeName,
      quantidade,
      percentual: total > 0 ? (quantidade / total) * 100 : 0,
    }))
    .sort((a, b) => b.quantidade - a.quantidade);
}

export type SugestaoRetirada = {
  storeId: string;
  loja: string;
  grupo: string;
  produto: string;
  tamanhosTotal: number;
  tamanhosZerados: number;
  pctQuebrada: number; // 0-100
  estoqueRestante: number;
  tamanhosComEstoque: { tamanho: string; quantidade: number }[];
};

// Limiar de "grade quebrada" — pedido do Rodrigo em 2026-09-02: inicialmente 60%, baixado pra
// 40% (mesmo dia) pra pegar mais cedo. 40% ou mais dos tamanhos de um produto zerados NUMA LOJA
// sugere retirar o que sobrou de lá (grade incompleta vende mal e ocupa espaço). Deliberadamente
// só olha a grade da PRÓPRIA loja, sem comparar com outras lojas nem com o CD ("não tem que
// comparar loja com loja ou loja com CD" — instrução direta dele).
const LIMIAR_GRADE_QUEBRADA = 0.4;

export async function getSugestoesRetiradaEstoque(
  filters: Pick<DashboardFilters, "storeIds" | "grupoIn" | "colecaoIn">
): Promise<SugestaoRetirada[]> {
  // Fora o CD/Site e Atacado — pedido do Rodrigo em 2026-09-02: "retirar da loja" é sobre
  // espaço físico de prateleira, não faz sentido pro estoque do site/depósito central.
  const sellingStores = await prisma.store.findMany({
    where: {
      sellsProducts: true,
      code: { not: "CD" },
      ...(filters.storeIds !== undefined ? { id: { in: filters.storeIds } } : {}),
    },
  });
  const storeIds = sellingStores.map((s) => s.id);
  const storeNameById = new Map(sellingStores.map((s) => [s.id, s.displayGroup ?? s.name]));

  const rows = await prisma.stockSnapshot.findMany({
    where: {
      storeId: { in: storeIds },
      grupo: { not: "(sem grupo)" },
      ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
      ...(filters.colecaoIn ? { colecao: { in: filters.colecaoIn } } : {}),
    },
    select: { storeId: true, grupo: true, produto: true, tamanho: true, quantidadeDisponivel: true },
  });

  const porChave = new Map<
    string,
    { storeId: string; grupo: string; produto: string; tamanhos: { tamanho: string; quantidade: number }[] }
  >();
  for (const r of rows) {
    const key = `${r.storeId}::${r.produto}`;
    const cur = porChave.get(key) ?? { storeId: r.storeId, grupo: r.grupo, produto: r.produto, tamanhos: [] };
    cur.tamanhos.push({ tamanho: r.tamanho ?? "—", quantidade: r.quantidadeDisponivel });
    porChave.set(key, cur);
  }

  const sugestoes: SugestaoRetirada[] = [];
  for (const { storeId, grupo, produto, tamanhos } of porChave.values()) {
    // Grade de 1 tamanho só não tem o que "quebrar" — não é o caso que o Rodrigo descreveu.
    if (tamanhos.length < 2) continue;
    const zerados = tamanhos.filter((t) => t.quantidade === 0).length;
    const pct = zerados / tamanhos.length;
    // 60% ou mais zerado já entra (inclusive, não só acima de 60% — confirmado com o Rodrigo).
    if (pct < LIMIAR_GRADE_QUEBRADA) continue;
    const tamanhosComEstoque = tamanhos.filter((t) => t.quantidade > 0);
    const estoqueRestante = tamanhosComEstoque.reduce((s, t) => s + t.quantidade, 0);
    // Sem estoque nenhum sobrando não tem o que retirar — já é "sem estoque", outro problema.
    if (estoqueRestante === 0) continue;
    sugestoes.push({
      storeId,
      loja: storeNameById.get(storeId) ?? storeId,
      grupo,
      produto,
      tamanhosTotal: tamanhos.length,
      tamanhosZerados: zerados,
      pctQuebrada: pct * 100,
      estoqueRestante,
      tamanhosComEstoque: sortTamanhos(tamanhosComEstoque.map((t) => t.tamanho)).map(
        (tamanho) => tamanhosComEstoque.find((t) => t.tamanho === tamanho)!
      ),
    });
  }

  return sugestoes.sort((a, b) => b.pctQuebrada - a.pctQuebrada || a.estoqueRestante - b.estoqueRestante);
}

// Grade de tamanho por texto de busca (grupo OU produto, contém, sem acento/case) — usada pela
// API do GPT (/api/gpt), pedido do Rodrigo em 2026-09-08: perguntar "qual a grade de tal produto"
// e ver, por loja, quanto tem de cada tamanho (incluindo os zerados), não só quem já está
// "quebrado" acima do limiar (diferente de getSugestoesRetiradaEstoque, que só lista candidato a
// retirada). Casa tanto "Classic Lisa" (grupo, agrega as cores todas) quanto "Classic Blue"
// (produto específico).
export async function getGradeTamanhoBusca(query: string, filters: Pick<DashboardFilters, "storeIds">) {
  const sellingStores = await prisma.store.findMany({
    where: {
      sellsProducts: true,
      code: { not: "CD" },
      ...(filters.storeIds !== undefined ? { id: { in: filters.storeIds } } : {}),
    },
  });
  const storeIds = sellingStores.map((s) => s.id);
  const storeNameById = new Map(sellingStores.map((s) => [s.id, s.displayGroup ?? s.name]));

  const rows = await prisma.stockSnapshot.findMany({
    where: {
      storeId: { in: storeIds },
      grupo: { not: "(sem grupo)" },
      OR: [
        { grupo: { contains: query, mode: "insensitive" } },
        { produto: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { storeId: true, tamanho: true, quantidadeDisponivel: true },
  });

  const porLoja = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const tamanho = r.tamanho ?? "—";
    const tamanhos = porLoja.get(r.storeId) ?? new Map<string, number>();
    tamanhos.set(tamanho, (tamanhos.get(tamanho) ?? 0) + r.quantidadeDisponivel);
    porLoja.set(r.storeId, tamanhos);
  }

  return [...porLoja.entries()]
    .map(([storeId, tamanhosMap]) => {
      const tamanhos = sortTamanhos([...tamanhosMap.keys()]).map((t) => ({ tamanho: t, quantidade: tamanhosMap.get(t)! }));
      const zerados = tamanhos.filter((t) => t.quantidade === 0).length;
      return {
        loja: storeNameById.get(storeId) ?? storeId,
        tamanhos,
        tamanhosZerados: zerados,
        tamanhosTotal: tamanhos.length,
        pctQuebrada: tamanhos.length > 0 ? Math.round((zerados / tamanhos.length) * 1000) / 10 : 0,
        gradeQuebrada: tamanhos.length > 0 && zerados / tamanhos.length >= LIMIAR_GRADE_QUEBRADA,
      };
    })
    .sort((a, b) => b.pctQuebrada - a.pctQuebrada);
}

export type MesMapaCompras = {
  mes: string; // "2025-09"
  tipo: "realizado" | "projetado";
  estoqueInicial: number;
  // Total que realmente entrou no estoque naquele mês (correção do Rodrigo em 2026-09-03: "faça a
  // conta correto" — estoque físico nunca foi negativo, então "Recebimento" tem que ser o total
  // verdadeiro, não só a fatia que a ordem de produção enxerga). Nos meses realizados = produção
  // interna registrada + o que precisou ter entrado por fora disso (comprado pronto de
  // fornecedor, por exemplo — grupos como Bola/Parafina/Chapéu não passam por ordem de produção
  // NENHUMA e mesmo assim têm estoque e venda, prova de que existe entrada por outro canal que o
  // DAPIC não expõe como endpoint separado). Nos meses futuros = "Falta comprar" do próprio mês
  // (a compra recomendada, assumida como feita na hora).
  recebimento: number;
  vendas: number;
  bonificacoes: number;
  estoqueFinal: number;
  estoqueIdeal: number;
  // Meses de cobertura no início do mês (estoqueInicial ÷ vendas) — derivado, não é projeção
  // própria. Trocado de estoqueFinal pra estoqueInicial em 2026-09-08 a pedido do Rodrigo, pra
  // bater com a convenção de "cobertura" usada no resto do app (estoque que já tinha ÷ ritmo de
  // venda — ver diasCobertura em getReplenishmentRisk).
  coberturaAtual: number | null;
  faltaComprar: number;
};

export type MapaComprasProduto = {
  produto: string;
  meses: MesMapaCompras[];
};

export type MapaComprasGrupo = {
  grupo: string;
  coberturaMeses: number;
  meses: MesMapaCompras[];
  produtos: MapaComprasProduto[];
};

// Cobertura padrão quando o grupo ainda não tem meta configurada (CoberturaMeta) — 2 meses é um
// ponto de partida neutro, ajustável na própria tela.
const COBERTURA_PADRAO_MESES = 2;

// Primeiro mês com histórico granular por grupo/produto no Radar (dados do DAPIC começam em
// set/2025 — antes disso só existe o site antigo, sem esse detalhe, ver primeiraCompraExterna).
const MAPA_COMPRAS_INICIO = "2025-09";

// Grupos fora do planejamento de compra (pedido do Rodrigo em 2026-09-08) — só nessa tela, os
// outros grupos continuam aparecendo normalmente em Vendas/Estoque/etc.
const MAPA_COMPRAS_GRUPOS_EXCLUIDOS = ["Ultra Dry", "Chapéu"];
const MAPA_COMPRAS_MESES_FUTUROS = 12;

function gerarListaMeses(inicio: string, fim: string): string[] {
  const meses: string[] = [];
  let [y, m] = inicio.split("-").map(Number);
  const [yFim, mFim] = fim.split("-").map(Number);
  while (y < yFim || (y === yFim && m <= mFim)) {
    meses.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return meses;
}

function somaChave<T extends { grupo: string; produto: string; mes: Date; unidades: bigint }>(
  rows: T[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const mesStr = new Date(r.mes).toISOString().slice(0, 7);
    const key = `${r.grupo}::${r.produto}::${mesStr}`;
    map.set(key, (map.get(key) ?? 0) + Number(r.unidades));
  }
  return map;
}

// Mapa de Compras — pedido do Rodrigo em 2026-09-02, baseado numa planilha de planejamento de
// compra que ele já usa. Reconstrói o RAZÃO DE ESTOQUE mês a mês (igual a um livro-caixa, mas de
// peças): Estoque Inicial + Recebimento (produção finalizada) − Vendas líquidas − Bonificações =
// Estoque Final, e o Estoque Final de um mês vira o Inicial do próximo. Como só existe o estoque
// ATUAL gravado (StockSnapshot é sobrescrito a cada sync, não histórico — mesma limitação já
// documentada no rascunho de "estoque histórico"), os meses passados são reconstruídos ANDANDO
// PRA TRÁS a partir do estoque de agora: desfaz mês a mês o que entrou/saiu até chegar no início
// do histórico (set/2025). Não é um fato gravado — é matemática de conservação (o que saiu tem
// que ter estado lá antes), então bate exato desde que a gente não tenha perdido nenhuma
// venda/produção no meio do caminho.
//
// Meses futuros (projetado): vendas planejadas por receita (ano anterior × crescimento, ver
// abaixo). Recebimento futuro = "Falta comprar" do PRÓPRIO mês — pedido do Rodrigo em 2026-09-03:
// a projeção assume que a compra recomendada é feita na hora, então o estoque nunca fica devendo o
// que já foi sinalizado como necessário (estoque físico nunca é negativo, nem no passado
// reconstruído nem na projeção). Estoque Ideal = Vendas Planejadas × Cobertura (meses configurável
// por grupo). Falta comprar = Estoque Ideal − Estoque Inicial daquele mês (antes da compra), só nos
// meses projetados (comprar pro passado não existe).
export async function getMapaDeComprasDetalhado(
  filters: Pick<DashboardFilters, "grupoIn">
): Promise<MapaComprasGrupo[]> {
  const hojeBrasiliaStr = todayBrasiliaStr(new Date());
  const mesAtual = hojeBrasiliaStr.slice(0, 7);
  const inicioMesAtual = brasiliaDayStart(`${mesAtual}-01`);
  const inicioHistorico = brasiliaDayStart(`${MAPA_COMPRAS_INICIO}-01`);
  const agora = new Date();

  const [yAtual, mAtualNum] = mesAtual.split("-").map(Number);
  let yFim = yAtual;
  let mFim = mAtualNum + MAPA_COMPRAS_MESES_FUTUROS;
  while (mFim > 12) {
    mFim -= 12;
    yFim++;
  }
  const mesFim = `${yFim}-${String(mFim).padStart(2, "0")}`;
  const todosMeses = gerarListaMeses(MAPA_COMPRAS_INICIO, mesFim);
  const mesesPassados = todosMeses.filter((m) => m < mesAtual);

  const grupoFiltro = Prisma.sql`
    ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
    AND "grupo" != ALL(${MAPA_COMPRAS_GRUPOS_EXCLUIDOS})
  `;

  const [vendasRows, devolucaoRows, recebimentoRows, bonifRows, vendasParcialRows, recebimentoParcialRows, bonifParcialRows, estoqueAtualRows, metasRows, configRow] =
    await Promise.all([
      prisma.$queryRaw<{ grupo: string; produto: string; mes: Date; unidades: bigint; receita: number }[]>`
      SELECT "grupo", "produto", DATE_TRUNC('month', ("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') AS mes, SUM("quantidade") AS unidades, SUM("valorTotalLiquido") AS receita
      FROM "Sale"
      WHERE "saleDate" >= ${inicioHistorico} AND "saleDate" < ${inicioMesAtual} AND "grupo" != '(sem grupo)' ${grupoFiltro}
      GROUP BY "grupo", "produto", mes
    `,
      prisma.$queryRaw<{ grupo: string; produto: string; mes: Date; unidades: bigint; receita: number }[]>`
      SELECT "grupo", "produto", DATE_TRUNC('month', ("returnDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') AS mes, SUM("quantidade") AS unidades, SUM("valorTotal") AS receita
      FROM "Return"
      WHERE "returnDate" >= ${inicioHistorico} AND "returnDate" < ${inicioMesAtual} AND "grupo" != '(sem grupo)' ${grupoFiltro}
      GROUP BY "grupo", "produto", mes
    `,
      prisma.$queryRaw<{ grupo: string; produto: string; mes: Date; unidades: bigint }[]>`
      SELECT "grupo", "produto", DATE_TRUNC('month', ("dataFinalizacaoProducao" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') AS mes, SUM("quantidade") AS unidades
      FROM "ProductionOrder"
      WHERE "dataFinalizacaoProducao" >= ${inicioHistorico} AND "dataFinalizacaoProducao" < ${inicioMesAtual} AND "grupo" != '(sem grupo)' ${grupoFiltro}
      GROUP BY "grupo", "produto", mes
    `,
      prisma.$queryRaw<{ grupo: string; produto: string; mes: Date; unidades: bigint }[]>`
      SELECT "grupo", "produto", DATE_TRUNC('month', ("giftDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') AS mes, SUM("quantidade") AS unidades
      FROM "Gift"
      WHERE "giftDate" >= ${inicioHistorico} AND "giftDate" < ${inicioMesAtual} AND "grupo" != '(sem grupo)' ${grupoFiltro}
      GROUP BY "grupo", "produto", mes
    `,
      // Fatia do mês corrente até agora (parcial) — ponte entre o estoque ATUAL (live) e o
      // estoque no início do mês corrente, de onde a reconstrução andando pra trás começa.
      prisma.$queryRaw<{ grupo: string; produto: string; unidades: bigint }[]>`
      SELECT "grupo", "produto", SUM("quantidade") AS unidades FROM "Sale"
      WHERE "saleDate" >= ${inicioMesAtual} AND "saleDate" <= ${agora} AND "grupo" != '(sem grupo)' ${grupoFiltro}
      GROUP BY "grupo", "produto"
    `,
      prisma.$queryRaw<{ grupo: string; produto: string; unidades: bigint }[]>`
      SELECT "grupo", "produto", SUM("quantidade") AS unidades FROM "ProductionOrder"
      WHERE "dataFinalizacaoProducao" >= ${inicioMesAtual} AND "dataFinalizacaoProducao" <= ${agora} AND "grupo" != '(sem grupo)' ${grupoFiltro}
      GROUP BY "grupo", "produto"
    `,
      prisma.$queryRaw<{ grupo: string; produto: string; unidades: bigint }[]>`
      SELECT "grupo", "produto", SUM("quantidade") AS unidades FROM "Gift"
      WHERE "giftDate" >= ${inicioMesAtual} AND "giftDate" <= ${agora} AND "grupo" != '(sem grupo)' ${grupoFiltro}
      GROUP BY "grupo", "produto"
    `,
      prisma.stockSnapshot.groupBy({
        by: ["grupo", "produto"],
        where: {
          grupo: {
            notIn: ["(sem grupo)", ...MAPA_COMPRAS_GRUPOS_EXCLUIDOS],
            ...(filters.grupoIn ? { in: filters.grupoIn } : {}),
          },
        },
        _sum: { quantidadeDisponivel: true },
      }),
      prisma.coberturaMeta.findMany(),
      prisma.mapaComprasConfig.findUnique({ where: { id: "global" } }),
    ]);

  const crescimentoPct = configRow?.crescimentoPct ?? 0;

  const vendasByKey = somaChave(vendasRows);
  const devolucaoByKey = somaChave(devolucaoRows);
  // Receita líquida por grupo::produto::mes (vendas - devolução, mesma chave/formato de
  // vendasByKey) — usada só pra projetar o futuro (ano anterior × crescimento), não aparece
  // como coluna na grade.
  const receitaVendasByKey = new Map<string, number>();
  for (const r of vendasRows) {
    const mesStr = new Date(r.mes).toISOString().slice(0, 7);
    const key = `${r.grupo}::${r.produto}::${mesStr}`;
    receitaVendasByKey.set(key, (receitaVendasByKey.get(key) ?? 0) + Number(r.receita));
  }
  const receitaDevolucaoByKey = new Map<string, number>();
  for (const r of devolucaoRows) {
    const mesStr = new Date(r.mes).toISOString().slice(0, 7);
    const key = `${r.grupo}::${r.produto}::${mesStr}`;
    receitaDevolucaoByKey.set(key, (receitaDevolucaoByKey.get(key) ?? 0) + Number(r.receita));
  }
  function receitaLiquida(grupo: string, produto: string, mes: string): number {
    const mesKey = `${grupo}::${produto}::${mes}`;
    return (receitaVendasByKey.get(mesKey) ?? 0) - (receitaDevolucaoByKey.get(mesKey) ?? 0);
  }
  const recebimentoByKey = somaChave(recebimentoRows);
  const bonifByKey = somaChave(bonifRows);

  function somaParcial(rows: { grupo: string; produto: string; unidades: bigint }[]) {
    const map = new Map<string, number>();
    for (const r of rows) map.set(`${r.grupo}::${r.produto}`, Number(r.unidades));
    return map;
  }
  const vendasParcialByKey = somaParcial(vendasParcialRows);
  const recebimentoParcialByKey = somaParcial(recebimentoParcialRows);
  const bonifParcialByKey = somaParcial(bonifParcialRows);

  const estoqueAtualByKey = new Map(
    estoqueAtualRows.map((r) => [`${r.grupo}::${r.produto}`, r._sum.quantidadeDisponivel ?? 0])
  );
  const metaByGrupo = new Map(metasRows.map((m) => [m.grupo, m.mesesCobertura]));

  const produtosPorGrupo = new Map<string, Set<string>>();
  for (const key of estoqueAtualByKey.keys()) {
    const [grupo, produto] = key.split("::");
    const set = produtosPorGrupo.get(grupo) ?? new Set<string>();
    set.add(produto);
    produtosPorGrupo.set(grupo, set);
  }
  // Inclui bonifByKey também — achado na auditoria de 2026-09-02: produto que só existe via
  // Brinde (nunca vendido, nunca com estoque, nunca produzido) sumia silenciosamente da grade.
  for (const [key] of [...vendasByKey, ...recebimentoByKey, ...bonifByKey]) {
    const [grupo, produto] = key.split("::");
    const set = produtosPorGrupo.get(grupo) ?? new Set<string>();
    set.add(produto);
    produtosPorGrupo.set(grupo, set);
  }

  // Receita por GRUPO (soma de todos os produtos) em cada mês passado — base pra "ano anterior"
  // e pra participação (%) de cada produto dentro da receita do grupo.
  const receitaGrupoPorMes = new Map<string, Map<string, number>>();
  for (const [grupo, produtosSet] of produtosPorGrupo) {
    const porMesGrupo = new Map<string, number>();
    for (const mes of mesesPassados) {
      let soma = 0;
      for (const produto of produtosSet) soma += receitaLiquida(grupo, produto, mes);
      porMesGrupo.set(mes, soma);
    }
    receitaGrupoPorMes.set(grupo, porMesGrupo);
  }

  // Participação de cada produto na receita do grupo — pedido do Rodrigo em 2026-09-03: "usar o
  // % da receita de cada produto do mês anterior". Mês de referência = último mês completo
  // realizado. Sem receita nenhuma do grupo nesse mês, divide igual entre os produtos (em vez de
  // zerar todo mundo à toa).
  const mesReferenciaShare = mesesPassados[mesesPassados.length - 1];
  function shareProduto(grupo: string, produto: string): number {
    const receitaGrupoRef = receitaGrupoPorMes.get(grupo)?.get(mesReferenciaShare) ?? 0;
    if (receitaGrupoRef <= 0) {
      const qtdProdutos = produtosPorGrupo.get(grupo)?.size ?? 1;
      return 1 / qtdProdutos;
    }
    return receitaLiquida(grupo, produto, mesReferenciaShare) / receitaGrupoRef;
  }

  // Projeção de receita do GRUPO por mês futuro = receita do MESMO MÊS DO ANO ANTERIOR ×
  // (1 + crescimento que o Rodrigo escolhe) — mesma lógica de "Crescimento do Ticket" da
  // planilha dele, mas em cima da receita (mês contra mês, ano contra ano), não de uma média/
  // tendência calculada. Calculado em ordem cronológica pra que o mês futuro mais distante possa
  // referenciar um mês futuro anterior já calculado (o histórico real só cobre ~12 meses).
  const mesesFuturosGlobal = todosMeses.filter((m) => m >= mesAtual);
  const receitaProjetadaGrupoPorMes = new Map<string, Map<string, number>>();
  for (const [grupo] of produtosPorGrupo) {
    const porMesGrupo = receitaGrupoPorMes.get(grupo)!;
    const projetado = new Map<string, number>();
    for (const mes of mesesFuturosGlobal) {
      const [y, m] = mes.split("-").map(Number);
      const mesAnoAnterior = `${y - 1}-${String(m).padStart(2, "0")}`;
      const receitaAnoAnterior = porMesGrupo.get(mesAnoAnterior) ?? projetado.get(mesAnoAnterior) ?? 0;
      projetado.set(mes, Math.max(0, receitaAnoAnterior * (1 + crescimentoPct / 100)));
    }
    receitaProjetadaGrupoPorMes.set(grupo, projetado);
  }

  // Calcula a série de meses de UM produto (chave grupo::produto), reconstruindo pra trás a
  // partir do estoque atual e projetando pra frente com receita (ano anterior × crescimento,
  // distribuída pela participação do produto, convertida de volta pra unidade pelo preço médio).
  function calcularSerie(grupo: string, produto: string, coberturaMeses: number): MesMapaCompras[] {
    const key = `${grupo}::${produto}`;
    const estoqueAtual = estoqueAtualByKey.get(key) ?? 0;

    const fluxoParcialAtual =
      (recebimentoParcialByKey.get(key) ?? 0) - (vendasParcialByKey.get(key) ?? 0) - (bonifParcialByKey.get(key) ?? 0);
    // Estoque físico nunca é negativo (correção do Rodrigo em 2026-09-03) — trava em 0 mesmo nessa
    // fronteira do mês corrente.
    const estoqueInicioMesAtual = Math.max(0, estoqueAtual - fluxoParcialAtual);

    // Reconstrói pra trás: estoqueInicial(M) = estoqueFinal(M) - Recebimento(M) + Vendas(M) +
    // Bonificações(M), onde estoqueFinal(M) = estoqueInicial(M+1) por continuidade. Estoque físico
    // nunca é negativo (nunca foi, correção direta do Rodrigo em 2026-09-03) — e a produção
    // registrada às vezes é MAIOR do que cabe na conta daquele mês (produção registrada inclui
    // peça que não virou estoque vendável na hora — defeito, célula de outro armazenador, etc.).
    // Nesse caso o "Recebimento" mostrado é travado no que efetivamente cabe pra fechar a conta
    // em Estoque Inicial = 0 (nunca inventa entrada além do que foi registrado, só deixa de
    // creditar o excedente que não bate como estoque vendável naquele mês específico) — matemática
    // exata: Estoque Inicial + Recebimento (mostrado) − Vendas − Bonificações = Estoque Final,
    // sempre, sem resto.
    const porMes = new Map<string, MesMapaCompras>();
    let estoqueFinalCursor = estoqueInicioMesAtual;
    for (let i = mesesPassados.length - 1; i >= 0; i--) {
      const mes = mesesPassados[i];
      const mesKey = `${key}::${mes}`;
      const vendas = Math.max(0, (vendasByKey.get(mesKey) ?? 0) - (devolucaoByKey.get(mesKey) ?? 0));
      const recebimentoProducao = recebimentoByKey.get(mesKey) ?? 0;
      const bonificacoes = bonifByKey.get(mesKey) ?? 0;
      const estoqueFinal = estoqueFinalCursor;
      // Teto: quanto de recebimento cabe nesse mês sem exigir estoque inicial negativo.
      const tetoRecebimento = estoqueFinal + vendas + bonificacoes;
      const recebimento = Math.min(recebimentoProducao, tetoRecebimento);
      const estoqueInicial = estoqueFinal - recebimento + vendas + bonificacoes; // sempre ≥ 0 por construção
      const estoqueFinalArred = Math.round(estoqueFinal);
      porMes.set(mes, {
        mes,
        tipo: "realizado",
        estoqueInicial,
        recebimento,
        vendas,
        bonificacoes,
        estoqueFinal: estoqueFinalArred,
        estoqueIdeal: Math.round(vendas * coberturaMeses),
        coberturaAtual: vendas > 0 ? Math.round((estoqueInicial / vendas) * 10) / 10 : null,
        faltaComprar: 0, // comprar pro passado não existe, só informativo
      });
      estoqueFinalCursor = estoqueInicial;
    }

    // Projeção pra frente por RECEITA — pedido direto do Rodrigo em 2026-09-03, comparando com a
    // fórmula real da planilha dele ("Crescimento do Ticket" aplicado sobre a receita, mês
    // contra mês do ano anterior): receita do grupo no mesmo mês do ano anterior × (1 +
    // crescimento escolhido por ele), distribuída pra esse produto pela % de participação dele
    // na receita do grupo (mês de referência = último mês completo), convertida de volta pra
    // unidade pelo preço médio de venda do produto nos últimos 3 meses (fallback: histórico
    // inteiro; sem nenhuma venda ainda, projeta 0).
    const receitaUltimos3 = mesesPassados.slice(-3).reduce((s, m) => s + receitaLiquida(grupo, produto, m), 0);
    const unidadesUltimos3 = mesesPassados.slice(-3).reduce((s, m) => s + (porMes.get(m)?.vendas ?? 0), 0);
    const receitaTodoHistorico = mesesPassados.reduce((s, m) => s + receitaLiquida(grupo, produto, m), 0);
    const unidadesTodoHistorico = mesesPassados.reduce((s, m) => s + (porMes.get(m)?.vendas ?? 0), 0);
    const precoMedio =
      unidadesUltimos3 > 0
        ? receitaUltimos3 / unidadesUltimos3
        : unidadesTodoHistorico > 0
          ? receitaTodoHistorico / unidadesTodoHistorico
          : 0;
    const share = shareProduto(grupo, produto);
    const receitaProjetadaGrupo = receitaProjetadaGrupoPorMes.get(grupo)!;

    let estoqueInicialCursor = estoqueInicioMesAtual;
    const mesesFuturos = mesesFuturosGlobal;
    for (const mes of mesesFuturos) {
      const receitaProjetadaProduto = (receitaProjetadaGrupo.get(mes) ?? 0) * share;
      const vendasProjetadas = precoMedio > 0 ? Math.max(0, Math.round(receitaProjetadaProduto / precoMedio)) : 0;
      const estoqueInicial = estoqueInicialCursor;
      const estoqueIdeal = vendasProjetadas * coberturaMeses;
      // "Falta comprar" já entra como recebimento no PRÓPRIO mês (pedido do Rodrigo em
      // 2026-09-03: a projeção assume que a compra recomendada é feita na hora) — o estoque
      // projetado nunca fica devendo o que a própria tela está recomendando comprar.
      const faltaComprar = Math.max(0, Math.round(estoqueIdeal - estoqueInicial));
      const recebimento = faltaComprar;
      const estoqueFinal = Math.max(0, estoqueInicial + recebimento - vendasProjetadas);
      porMes.set(mes, {
        mes,
        tipo: "projetado",
        estoqueInicial: Math.round(estoqueInicial),
        recebimento,
        vendas: vendasProjetadas,
        bonificacoes: 0,
        estoqueFinal: Math.round(estoqueFinal),
        estoqueIdeal: Math.round(estoqueIdeal),
        coberturaAtual: vendasProjetadas > 0 ? Math.round((estoqueInicial / vendasProjetadas) * 10) / 10 : null,
        faltaComprar,
      });
      estoqueInicialCursor = estoqueFinal;
    }

    return todosMeses.map((m) => porMes.get(m)!);
  }

  function somarSeries(series: MesMapaCompras[][]): MesMapaCompras[] {
    return todosMeses.map((mes, i) => {
      const linhas = series.map((s) => s[i]);
      const vendas = linhas.reduce((s, l) => s + l.vendas, 0);
      const estoqueFinal = linhas.reduce((s, l) => s + l.estoqueFinal, 0);
      const estoqueInicial = linhas.reduce((s, l) => s + l.estoqueInicial, 0);
      return {
        mes,
        tipo: linhas[0]?.tipo ?? "realizado",
        estoqueInicial,
        recebimento: linhas.reduce((s, l) => s + l.recebimento, 0),
        vendas,
        bonificacoes: linhas.reduce((s, l) => s + l.bonificacoes, 0),
        estoqueFinal,
        estoqueIdeal: linhas.reduce((s, l) => s + l.estoqueIdeal, 0),
        // Cobertura do grupo não é a média das coberturas por produto — recalcula do total
        // (senão um produto zerado com "cobertura null" distorceria a média).
        coberturaAtual: vendas > 0 ? Math.round((estoqueInicial / vendas) * 10) / 10 : null,
        faltaComprar: linhas.reduce((s, l) => s + l.faltaComprar, 0),
      };
    });
  }

  const grupos: MapaComprasGrupo[] = [];
  for (const [grupo, produtosSet] of produtosPorGrupo) {
    const coberturaMeses = metaByGrupo.get(grupo) ?? COBERTURA_PADRAO_MESES;
    const produtos = [...produtosSet]
      .map((produto) => ({ produto, meses: calcularSerie(grupo, produto, coberturaMeses) }))
      .sort((a, b) => b.meses[mesesPassados.length]?.faltaComprar - a.meses[mesesPassados.length]?.faltaComprar);
    grupos.push({
      grupo,
      coberturaMeses,
      meses: somarSeries(produtos.map((p) => p.meses)),
      produtos,
    });
  }

  // Ordem alfabética — pedido do Rodrigo em 2026-09-08 (antes era por "falta comprar" no mês
  // atual, decrescente).
  return grupos.sort((a, b) => a.grupo.localeCompare(b.grupo, "pt-BR"));
}

export async function setCoberturaMeta(grupo: string, mesesCobertura: number) {
  await prisma.coberturaMeta.upsert({
    where: { grupo },
    create: { grupo, mesesCobertura },
    update: { mesesCobertura },
  });
}

export async function getCrescimentoEsperado(): Promise<number> {
  const row = await prisma.mapaComprasConfig.findUnique({ where: { id: "global" } });
  return row?.crescimentoPct ?? 0;
}

export async function setCrescimentoEsperado(crescimentoPct: number) {
  await prisma.mapaComprasConfig.upsert({
    where: { id: "global" },
    create: { id: "global", crescimentoPct },
    update: { crescimentoPct },
  });
}

export async function getMinimumRules() {
  return prisma.stockMinimumRule.findMany({
    include: { store: true },
    orderBy: [{ storeId: "asc" }, { grupo: "asc" }, { tamanho: "asc" }],
  });
}

// Cobertura de estoque: pra cada SKU com estoque > 0, calcula quantos dias de venda restam
// com base na média de vendas dos últimos 30 dias. Status: crítico < 7 dias, atenção 7-30 dias,
// ok 30-60 dias, excesso > 60 dias, sem-venda se não vendeu nada no período.
export async function getStockCoverage(
  filters: Pick<DashboardFilters, "storeIds" | "grupoIn" | "tabelasPreco">
) {
  const stock = (await latestStockSnapshots(filters)).filter((s) => s.quantidadeDisponivel > 0);
  if (stock.length === 0) return [];

  const storeIds = [...new Set(stock.map((s) => s.storeId))];
  const cods = [...new Set(stock.map((s) => s.cod))];

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [saleAgg, stores] = await Promise.all([
    prisma.sale.groupBy({
      by: ["storeId", "cod"],
      where: {
        storeId: { in: storeIds },
        cod: { in: cods },
        saleDate: { gte: thirtyDaysAgo },
        ...(filters.tabelasPreco !== undefined ? { tabelaPreco: { in: filters.tabelasPreco } } : {}),
      },
      _sum: { quantidade: true },
    }),
    prisma.store.findMany({ where: { id: { in: storeIds } } }),
  ]);

  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const salesByKey = new Map(saleAgg.map((s) => [`${s.storeId}::${s.cod}`, s._sum.quantidade ?? 0]));

  const statusOrder = { critico: 0, atencao: 1, ok: 2, excesso: 3, "sem-venda": 4 } as const;

  return stock
    .map((s) => {
      const vendas30d = salesByKey.get(`${s.storeId}::${s.cod}`) ?? 0;
      const avgDailySales = vendas30d / 30;
      const diasCobertura = avgDailySales > 0 ? Math.round(s.quantidadeDisponivel / avgDailySales) : null;
      const status: "critico" | "atencao" | "ok" | "excesso" | "sem-venda" =
        diasCobertura === null
          ? "sem-venda"
          : diasCobertura < 7
          ? "critico"
          : diasCobertura < 30
          ? "atencao"
          : diasCobertura <= 60
          ? "ok"
          : "excesso";
      return {
        storeName: storeName.get(s.storeId) ?? s.storeId,
        produto: s.produto,
        colecao: s.colecao ?? null,
        grupo: s.grupo,
        tamanho: s.tamanho,
        estoque: s.quantidadeDisponivel,
        vendas30d,
        avgDailySales,
        diasCobertura,
        status,
      };
    })
    .sort((a, b) => {
      const orderDiff = statusOrder[a.status] - statusOrder[b.status];
      if (orderDiff !== 0) return orderDiff;
      // within group: ascending diasCobertura (nulls last within sem-venda)
      if (a.diasCobertura === null && b.diasCobertura === null) return 0;
      if (a.diasCobertura === null) return 1;
      if (b.diasCobertura === null) return -1;
      return a.diasCobertura - b.diasCobertura;
    });
}
