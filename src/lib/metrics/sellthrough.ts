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


// Sellthrough por coleção: vendido_total / produzido_total, sem filtro de data.
// Produzido = ordens de produção (fonte mais correta que estoque+vendido).
export async function getSellthroughByColecao(filters: Pick<DashboardFilters, "storeIds" | "marcas" | "grupoIn">) {
  // Fórmula: ST = saida / (estoque_atual + saida)
  // onde saida = vendas - devoluções + brindes
  // Não depende de ordens de produção (que têm dados incompletos no DAPIC).

  const saleWhereColl = {
    colecao: { not: null as string | null },
    ...(filters.marcas !== undefined ? { marca: { in: filters.marcas } } : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
  };
  const stockWhereColl = {
    colecao: { not: null as string | null },
    grupo: { not: "(sem grupo)" },
    ...(filters.storeIds !== undefined ? { storeId: { in: filters.storeIds } } : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
  };

  const [sold, gifted, stock, returned, prodOrderProdutos] = await Promise.all([
    prisma.sale.groupBy({ by: ["colecao"], where: saleWhereColl, _sum: { quantidade: true, valorTotalLiquido: true } }),
    prisma.gift.groupBy({ by: ["colecao"], where: saleWhereColl, _sum: { quantidade: true } }),
    // Estoque atual agrupado por colecao
    prisma.stockSnapshot.groupBy({ by: ["colecao"], where: stockWhereColl, _sum: { quantidadeDisponivel: true } }),
    // Return não tem colecao — mapeia via produto
    prisma.return.groupBy({
      by: ["produto"],
      where: { ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}) },
      _sum: { quantidade: true },
    }),
    // Mapa produto → colecao via Sale (que sempre tem colecao quando vem da API)
    prisma.sale.findMany({
      where: { colecao: { not: null }, ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}) },
      select: { produto: true, colecao: true },
      distinct: ["produto"],
    }),
  ]);

  // Mapa produto → colecao para cruzar devoluções
  const produtoColecao = new Map<string, string>();
  for (const r of prodOrderProdutos) if (r.colecao) produtoColecao.set(r.produto, r.colecao);

  const returnedByColecao = new Map<string, number>();
  for (const r of returned) {
    const col = produtoColecao.get(r.produto);
    if (col) returnedByColecao.set(col, (returnedByColecao.get(col) ?? 0) + (r._sum.quantidade ?? 0));
  }

  const soldByColecao = new Map(sold.map((r) => [r.colecao ?? "—", { units: r._sum.quantidade ?? 0, revenue: r._sum.valorTotalLiquido ?? 0 }]));
  const giftedByColecao = new Map(gifted.map((r) => [r.colecao ?? "—", r._sum.quantidade ?? 0]));
  const stockByColecao = new Map(stock.map((r) => [r.colecao ?? "—", r._sum.quantidadeDisponivel ?? 0]));

  const colecoes = new Set([...soldByColecao.keys(), ...stockByColecao.keys()]);

  return [...colecoes]
    .map((colecao) => {
      const { units: vendido = 0, revenue = 0 } = soldByColecao.get(colecao) ?? {};
      const brinde = giftedByColecao.get(colecao) ?? 0;
      const devolvido = returnedByColecao.get(colecao) ?? 0;
      const estoque = stockByColecao.get(colecao) ?? 0;
      const saida = vendido - devolvido + brinde;
      const denominador = estoque + saida;
      const sellThroughRate = denominador > 0 ? (saida / denominador) * 100 : null;
      return { key: colecao, vendido, devolvido, brinde, saida, produzido: denominador, revenue, sellThroughRate };
    })
    .filter((r) => r.produzido > 0)
    .sort((a, b) => (b.sellThroughRate ?? 0) - (a.sellThroughRate ?? 0));
}

// Detalhe de sellthrough por coleção: grupo → produto, incluindo brindes.
// Fórmula: ST = saida / (estoque_atual + saida), onde saida = vendas - devoluções + brindes.
export async function getSellthroughColecaoDetalhe(
  filters: Pick<DashboardFilters, "marcas" | "grupoIn">,
  colecao?: string
) {
  const colecaoFilter = colecao ? { colecao } : { colecao: { not: null as string | null } };
  const saleGiftWhere = {
    ...colecaoFilter,
    ...(filters.marcas !== undefined ? { marca: { in: filters.marcas } } : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
  };

  const [sold, gifted, returned, stock] = await Promise.all([
    prisma.sale.groupBy({ by: ["grupo", "produto"], where: saleGiftWhere, _sum: { quantidade: true, valorTotalLiquido: true } }),
    prisma.gift.groupBy({ by: ["grupo", "produto"], where: saleGiftWhere, _sum: { quantidade: true } }),
    prisma.return.groupBy({
      by: ["grupo", "produto"],
      where: {
        produto: { in: await prisma.sale.findMany({ where: saleGiftWhere, select: { produto: true }, distinct: ["produto"] }).then((r) => r.map((s) => s.produto)) },
        ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
      },
      _sum: { quantidade: true },
    }),
    // Estoque atual por grupo+produto para a coleção selecionada
    prisma.stockSnapshot.groupBy({
      by: ["grupo", "produto"],
      where: {
        ...colecaoFilter,
        grupo: { not: "(sem grupo)" },
        ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
      },
      _sum: { quantidadeDisponivel: true },
    }),
  ]);

  type ProdRow = { grupo: string; produto: string; estoque: number; vendido: number; brinde: number; devolvido: number; revenue: number };
  const map = new Map<string, ProdRow>();

  for (const r of sold) {
    const k = `${r.grupo}\x00${r.produto}`;
    const cur = map.get(k) ?? { grupo: r.grupo, produto: r.produto, estoque: 0, vendido: 0, brinde: 0, devolvido: 0, revenue: 0 };
    cur.vendido += r._sum.quantidade ?? 0;
    cur.revenue += r._sum.valorTotalLiquido ?? 0;
    map.set(k, cur);
  }
  for (const r of gifted) {
    const k = `${r.grupo}\x00${r.produto}`;
    const cur = map.get(k) ?? { grupo: r.grupo, produto: r.produto, estoque: 0, vendido: 0, brinde: 0, devolvido: 0, revenue: 0 };
    cur.brinde += r._sum.quantidade ?? 0;
    map.set(k, cur);
  }
  for (const r of returned) {
    const k = `${r.grupo}\x00${r.produto}`;
    const cur = map.get(k);
    if (cur) cur.devolvido += r._sum.quantidade ?? 0;
  }
  for (const r of stock) {
    const k = `${r.grupo}\x00${r.produto}`;
    const cur = map.get(k);
    if (cur) cur.estoque += r._sum.quantidadeDisponivel ?? 0;
  }

  return [...map.values()]
    .filter((r) => r.vendido > 0 || r.estoque > 0)
    .map((r) => {
      const saida = r.vendido - r.devolvido + r.brinde;
      const denominador = r.estoque + saida;
      return {
        grupo: r.grupo,
        produto: r.produto,
        produzido: denominador,
        vendido: r.vendido,
        devolvido: r.devolvido,
        brinde: r.brinde,
        saida,
        revenue: r.revenue,
        sellThroughRate: denominador > 0 ? (saida / denominador) * 100 : null,
      };
    })
    .sort((a, b) => a.grupo.localeCompare(b.grupo, "pt-BR") || a.produto.localeCompare(b.produto, "pt-BR"));
}

// Lista de coleções disponíveis para o filtro
export async function getColecoes(filters: Pick<DashboardFilters, "marcas" | "grupoIn">) {
  const rows = await prisma.productionOrder.findMany({
    where: {
      colecao: { not: null },
      ...(filters.marcas !== undefined ? { marca: { in: filters.marcas } } : {}),
      ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
    },
    select: { colecao: true },
    distinct: ["colecao"],
    orderBy: { colecao: "asc" },
  });
  return rows.map((r) => r.colecao).filter(Boolean) as string[];
}

export type CurvaVidaColecao = {
  colecao: string;
  primeiraVenda: string; // ISO date da 1ª venda registrada — proxy de "data de lançamento"
  // percPeriodo = % do produzido vendido NAQUELE dia específico (não acumulado) — pedido do
  // Rodrigo em 2026-09-22: "no mês 1 vendeu 20%, no mês 2 vendeu 17%", não uma curva sempre
  // subindo/descendo. percCumulativo continua disponível pra quem precisar do total acumulado.
  pontos: { dias: number; percPeriodo: number; percCumulativo: number }[];
};

// Núcleo puro de getColecaoCurvaVida: a partir de "quando vendeu quanto" + o denominador
// (produzido), monta os pontos dia-de-vida a dia-de-vida. Extraído pra ser reaproveitado também
// nos níveis Grupo e Produto da tabela hierárquica (ver getCurvaVidaGrupoEProduto) — MESMA lógica
// de D0/janela/percPeriodo/percCumulativo em todos os níveis, só a origem dos "dias" e do
// "produzido" muda (nível a nível).
function curvaVidaFromDiasOffset(
  dias: { dia: Date; unidades: number }[],
  produzido: number,
  janelaDias: number
): Pick<CurvaVidaColecao, "primeiraVenda" | "pontos"> | null {
  if (dias.length === 0) return null;

  const primeiraVenda = dias[0].dia;
  const porDiaOffset = new Map<number, number>();
  for (const d of dias) {
    const offset = Math.round((d.dia.getTime() - primeiraVenda.getTime()) / 86_400_000);
    porDiaOffset.set(offset, (porDiaOffset.get(offset) ?? 0) + d.unidades);
  }

  const hojeOffset = Math.round((Date.now() - primeiraVenda.getTime()) / 86_400_000);
  const limiteOffset = Math.min(janelaDias, hojeOffset);

  let acumulado = 0;
  const pontos: { dias: number; percPeriodo: number; percCumulativo: number }[] = [];
  for (let offset = 0; offset <= limiteOffset; offset++) {
    const unidadesNoDia = porDiaOffset.get(offset) ?? 0;
    acumulado += unidadesNoDia;
    pontos.push({
      dias: offset,
      percPeriodo: (unidadesNoDia / produzido) * 100,
      percCumulativo: (acumulado / produzido) * 100,
    });
  }

  return { primeiraVenda: primeiraVenda.toISOString().slice(0, 10), pontos };
}

// "Curva de vida da coleção" — sell-through acumulado por dias desde o lançamento, pra comparar
// coleções na mesma régua de tempo em vez de calendário fixo (ex: "com quantos dias a Coleção X
// bateu 50%/80%?"). StockSnapshot só guarda o estoque ATUAL (não tem histórico diário, ver
// schema.prisma), então não dá pra recalcular o sell-through de cada dia do passado — em vez
// disso, soma-se o vendido dia a dia (cumulativo) contra o MESMO denominador (estoque atual +
// saída) já calculado em getSellthroughByColecao, recebido via `colecoesComDenominador`. Última
// posição da curva fica perto do sell-through da tabela "por coleção" (não idêntica: aqui não
// desconta devolução/soma brinde dia a dia, só no total — diferença normalmente pequena).
// "Dia 0" = data da 1ª venda da coleção (o DAPIC não expõe data de lançamento formal). Limita aos
// primeiros `janelaDias` de vida pra uma coleção esgotada há 1 ano não ficar numa régua diferente
// de uma coleção lançada semana passada.
export async function getColecaoCurvaVida(
  filters: Pick<DashboardFilters, "marcas" | "grupoIn">,
  colecoesComDenominador: { colecao: string; produzido: number }[],
  janelaDias = 90
): Promise<CurvaVidaColecao[]> {
  const alvo = colecoesComDenominador.filter((c) => c.produzido > 0);
  if (alvo.length === 0) return [];
  const colecoes = alvo.map((c) => c.colecao);

  const rows = await prisma.$queryRaw<{ colecao: string; dia: Date; unidades: bigint }[]>`
    SELECT "colecao",
      DATE_TRUNC('day', ("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') AS dia,
      SUM("quantidade") AS unidades
    FROM "Sale"
    WHERE "colecao" = ANY(${colecoes})
      ${filters.marcas !== undefined ? Prisma.sql`AND "marca" = ANY(${filters.marcas})` : Prisma.empty}
      ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
    GROUP BY "colecao", dia
    ORDER BY "colecao", dia ASC
  `;

  const porColecao = new Map<string, { dia: Date; unidades: number }[]>();
  for (const r of rows) {
    const list = porColecao.get(r.colecao) ?? [];
    list.push({ dia: r.dia, unidades: Number(r.unidades) });
    porColecao.set(r.colecao, list);
  }

  const resultado: CurvaVidaColecao[] = [];
  for (const { colecao, produzido } of alvo) {
    const dias = porColecao.get(colecao);
    if (!dias || dias.length === 0) continue;
    const curva = curvaVidaFromDiasOffset(dias, produzido, janelaDias);
    if (!curva) continue;
    resultado.push({ colecao, ...curva });
  }

  return resultado;
}

export type CurvaVidaNode = Pick<CurvaVidaColecao, "primeiraVenda" | "pontos"> & { key: string };

export type SellthroughHierarquico = {
  colecao: string;
  grupo: string;
  produto: string;
  vendido: number;
  devolvido: number;
  brinde: number;
  saida: number;
  produzido: number;
  revenue: number;
};

// Mesma fórmula de getSellthroughByColecao (ST = saida/(estoque+saida), sem filtro de data), na
// granularidade coleção→grupo→produto — pra alimentar os níveis Grupo/Produto da tabela
// hierárquica de Curva de Vida (getCurvaVidaGrupoEProduto). "produzido" de cada nível é sempre a
// soma literal dos filhos (grupo = soma dos produtos, coleção = soma dos grupos), então os valores
// brutos (vendido, estoque, produzido) sempre consolidam de baixo pra cima — só o % não soma
// exato entre níveis, porque cada nível usa sua própria base e seu próprio D0 (decisão do Rodrigo
// em 2026-09-23: cada nível deve ter a curva de vida própria dele, não uma fatia da coleção).
export async function getSellthroughHierarquico(
  filters: Pick<DashboardFilters, "storeIds" | "marcas" | "grupoIn">,
  colecoes: string[]
): Promise<SellthroughHierarquico[]> {
  if (colecoes.length === 0) return [];

  const saleWhereH = {
    colecao: { in: colecoes },
    ...(filters.marcas !== undefined ? { marca: { in: filters.marcas } } : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
  };
  const stockWhereH = {
    colecao: { in: colecoes },
    grupo: { not: "(sem grupo)" },
    ...(filters.storeIds !== undefined ? { storeId: { in: filters.storeIds } } : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
  };

  const [sold, gifted, stock, returned, produtoColecaoRows] = await Promise.all([
    prisma.sale.groupBy({
      by: ["colecao", "grupo", "produto"],
      where: saleWhereH,
      _sum: { quantidade: true, valorTotalLiquido: true },
    }),
    prisma.gift.groupBy({ by: ["colecao", "grupo", "produto"], where: saleWhereH, _sum: { quantidade: true } }),
    prisma.stockSnapshot.groupBy({
      by: ["colecao", "grupo", "produto"],
      where: stockWhereH,
      _sum: { quantidadeDisponivel: true },
    }),
    // Return não tem grupo/produto→colecao confiável em todo o histórico (colecao só passou a ser
    // gravada em 2026-09-14, ver schema.prisma) — mesmo workaround de getSellthroughByColecao:
    // mapeia produto→colecao via Sale.
    prisma.return.groupBy({
      by: ["grupo", "produto"],
      where: { ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}) },
      _sum: { quantidade: true },
    }),
    prisma.sale.findMany({
      where: { colecao: { in: colecoes }, ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}) },
      select: { produto: true, colecao: true },
      distinct: ["produto"],
    }),
  ]);

  const produtoColecao = new Map<string, string>();
  for (const r of produtoColecaoRows) if (r.colecao) produtoColecao.set(r.produto, r.colecao);

  type Acc = { colecao: string; grupo: string; produto: string; vendido: number; revenue: number; brinde: number; devolvido: number; estoque: number };
  const map = new Map<string, Acc>();
  const keyOf = (colecao: string, grupo: string, produto: string) => `${colecao}\x00${grupo}\x00${produto}`;

  for (const r of sold) {
    if (!r.colecao) continue;
    const k = keyOf(r.colecao, r.grupo, r.produto);
    const cur = map.get(k) ?? { colecao: r.colecao, grupo: r.grupo, produto: r.produto, vendido: 0, revenue: 0, brinde: 0, devolvido: 0, estoque: 0 };
    cur.vendido += r._sum.quantidade ?? 0;
    cur.revenue += r._sum.valorTotalLiquido ?? 0;
    map.set(k, cur);
  }
  for (const r of gifted) {
    if (!r.colecao) continue;
    const k = keyOf(r.colecao, r.grupo, r.produto);
    const cur = map.get(k) ?? { colecao: r.colecao, grupo: r.grupo, produto: r.produto, vendido: 0, revenue: 0, brinde: 0, devolvido: 0, estoque: 0 };
    cur.brinde += r._sum.quantidade ?? 0;
    map.set(k, cur);
  }
  for (const r of stock) {
    if (!r.colecao) continue;
    const k = keyOf(r.colecao, r.grupo, r.produto);
    const cur = map.get(k) ?? { colecao: r.colecao, grupo: r.grupo, produto: r.produto, vendido: 0, revenue: 0, brinde: 0, devolvido: 0, estoque: 0 };
    cur.estoque += r._sum.quantidadeDisponivel ?? 0;
    map.set(k, cur);
  }
  for (const r of returned) {
    const colecao = produtoColecao.get(r.produto);
    if (!colecao) continue;
    const k = keyOf(colecao, r.grupo, r.produto);
    const cur = map.get(k);
    if (cur) cur.devolvido += r._sum.quantidade ?? 0;
  }

  return [...map.values()]
    .filter((r) => r.vendido > 0 || r.estoque > 0)
    .map((r) => {
      const saida = r.vendido - r.devolvido + r.brinde;
      const produzido = r.estoque + saida;
      return {
        colecao: r.colecao,
        grupo: r.grupo,
        produto: r.produto,
        vendido: r.vendido,
        devolvido: r.devolvido,
        brinde: r.brinde,
        saida,
        produzido,
        revenue: r.revenue,
      };
    });
}

// Agrupa linhas diárias de venda (já vindas de uma query raw com colecao/grupo/produto/dia) por
// uma chave arbitrária, somando unidades por dia-calendário dentro de cada chave. Usado pra
// derivar tanto a série diária de cada Produto quanto a série diária consolidada de cada Grupo
// (grupo = soma dos produtos NO MESMO DIA DE CALENDÁRIO, antes de recalcular o offset D0 do
// grupo) a partir de uma única query.
function agruparDiasPorChave(
  rows: { colecao: string; grupo: string; produto: string; dia: Date; unidades: bigint }[],
  chaveDe: (r: { colecao: string; grupo: string; produto: string }) => string
): Map<string, { dia: Date; unidades: number }[]> {
  const porChaveEDia = new Map<string, Map<number, { dia: Date; unidades: number }>>();
  for (const r of rows) {
    const k = chaveDe(r);
    const porDia = porChaveEDia.get(k) ?? new Map<number, { dia: Date; unidades: number }>();
    const t = r.dia.getTime();
    const existente = porDia.get(t);
    if (existente) existente.unidades += Number(r.unidades);
    else porDia.set(t, { dia: r.dia, unidades: Number(r.unidades) });
    porChaveEDia.set(k, porDia);
  }
  const resultado = new Map<string, { dia: Date; unidades: number }[]>();
  for (const [k, porDia] of porChaveEDia) {
    resultado.set(k, [...porDia.values()].sort((a, b) => a.dia.getTime() - b.dia.getTime()));
  }
  return resultado;
}

// Curva de vida (D0..Djanela) nos níveis Grupo e Produto, pra expandir a tabela hierárquica da
// Curva de Vida da Coleção. Escopado só às coleções realmente exibidas na tabela (evita computar
// pra coleções fora do "Comparar"). Cada nó (grupo/produto) tem seu PRÓPRIO D0 (1ª venda dele) e
// sua PRÓPRIA base (produzido dele) — ver comentário de getSellthroughHierarquico.
export async function getCurvaVidaGrupoEProduto(
  filters: Pick<DashboardFilters, "storeIds" | "marcas" | "grupoIn">,
  colecoes: string[],
  janelaDias: number
): Promise<{ grupos: Map<string, CurvaVidaNode[]>; produtos: Map<string, CurvaVidaNode[]> }> {
  const grupos = new Map<string, CurvaVidaNode[]>();
  const produtos = new Map<string, CurvaVidaNode[]>();
  if (colecoes.length === 0) return { grupos, produtos };

  const hier = await getSellthroughHierarquico(filters, colecoes);
  if (hier.length === 0) return { grupos, produtos };

  const grupoKey = (colecao: string, grupo: string) => `${colecao}\x00${grupo}`;

  const produzidoPorGrupo = new Map<string, number>();
  for (const r of hier) {
    const k = grupoKey(r.colecao, r.grupo);
    produzidoPorGrupo.set(k, (produzidoPorGrupo.get(k) ?? 0) + r.produzido);
  }

  const rows = await prisma.$queryRaw<{ colecao: string; grupo: string; produto: string; dia: Date; unidades: bigint }[]>`
    SELECT "colecao", "grupo", "produto",
      DATE_TRUNC('day', ("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') AS dia,
      SUM("quantidade") AS unidades
    FROM "Sale"
    WHERE "colecao" = ANY(${colecoes})
      ${filters.marcas !== undefined ? Prisma.sql`AND "marca" = ANY(${filters.marcas})` : Prisma.empty}
      ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
    GROUP BY "colecao", "grupo", "produto", dia
  `;

  const diasPorGrupo = agruparDiasPorChave(rows, (r) => grupoKey(r.colecao, r.grupo));
  const diasPorProduto = agruparDiasPorChave(rows, (r) => `${r.colecao}\x00${r.grupo}\x00${r.produto}`);

  for (const [k, produzido] of produzidoPorGrupo) {
    if (produzido <= 0) continue;
    const [colecao, grupo] = k.split("\x00");
    const curva = curvaVidaFromDiasOffset(diasPorGrupo.get(k) ?? [], produzido, janelaDias);
    if (!curva) continue;
    const list = grupos.get(colecao) ?? [];
    list.push({ key: grupo, ...curva });
    grupos.set(colecao, list);
  }

  for (const r of hier) {
    if (r.produzido <= 0) continue;
    const kProduto = `${r.colecao}\x00${r.grupo}\x00${r.produto}`;
    const curva = curvaVidaFromDiasOffset(diasPorProduto.get(kProduto) ?? [], r.produzido, janelaDias);
    if (!curva) continue;
    const list = produtos.get(grupoKey(r.colecao, r.grupo)) ?? [];
    list.push({ key: r.produto, ...curva });
    produtos.set(grupoKey(r.colecao, r.grupo), list);
  }

  for (const list of grupos.values()) list.sort((a, b) => a.key.localeCompare(b.key, "pt-BR"));
  for (const list of produtos.values()) list.sort((a, b) => a.key.localeCompare(b.key, "pt-BR"));

  return { grupos, produtos };
}
