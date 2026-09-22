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
  pontos: { dias: number; percCumulativo: number }[];
};

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

    const primeiraVenda = dias[0].dia;
    const porDiaOffset = new Map<number, number>();
    for (const d of dias) {
      const offset = Math.round((d.dia.getTime() - primeiraVenda.getTime()) / 86_400_000);
      porDiaOffset.set(offset, (porDiaOffset.get(offset) ?? 0) + d.unidades);
    }

    const hojeOffset = Math.round((Date.now() - primeiraVenda.getTime()) / 86_400_000);
    const limiteOffset = Math.min(janelaDias, hojeOffset);

    let acumulado = 0;
    const pontos: { dias: number; percCumulativo: number }[] = [];
    for (let offset = 0; offset <= limiteOffset; offset++) {
      acumulado += porDiaOffset.get(offset) ?? 0;
      pontos.push({ dias: offset, percCumulativo: (acumulado / produzido) * 100 });
    }

    resultado.push({ colecao, primeiraVenda: primeiraVenda.toISOString().slice(0, 10), pontos });
  }

  return resultado;
}
