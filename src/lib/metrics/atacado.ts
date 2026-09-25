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
  getSiteAtacadoStoreIds,
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


export async function getAtacadoVendas(filters: DashboardFilters) {
  const siteAtacadoIds = await getSiteAtacadoStoreIds();
  if (siteAtacadoIds.length === 0) return { kpis: { receita: 0, pedidos: 0, unidades: 0, ticketMedio: 0 }, byMonth: [], topProdutos: [] };
  // Atacado só existe no canal Site+Atacado (2 lojas: CD e ATACADO, ver getSiteAtacadoStoreIds) —
  // usuário restrito que não tem nenhuma das duas liberada não vê nada aqui (achado na auditoria
  // de 2026-09-08: antes o storeId ficava hardcoded, ignorando a restrição).
  const storeIds = filters.storeIds !== undefined ? siteAtacadoIds.filter((id) => filters.storeIds!.includes(id)) : siteAtacadoIds;
  if (storeIds.length === 0) return { kpis: { receita: 0, pedidos: 0, unidades: 0, ticketMedio: 0 }, byMonth: [], topProdutos: [] };

  // Cliente já classificado como atacado (canalWhere("b2b")), não tabelaPreco direto — achado na
  // auditoria de 2026-09-02: essa aba tinha o mesmo bug da Guarderia (cliente que negocia preço
  // e cai em tabelaPreco=null ficava subcontado aqui, justamente na aba que É sobre atacado).
  const b2bWhere = await canalWhere("b2b");
  const b2bClientes = [...(await getB2BClienteNomes())];
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    storeId: { in: storeIds },
    AND: [b2bWhere],
  };

  const [agg, byMonthRaw, topGrupos] = await Promise.all([
    prisma.sale.aggregate({ where, _sum: { quantidade: true, valorTotalLiquido: true }, _count: { dapicVendaId: true } }),
    // Por mês, não por dia — e ignora filters.from/to de propósito (pedido do Rodrigo em
    // 2026-09-25, mesmo padrão das outras seções mensais do Radar, ex: "Vendas mensais por
    // família"): a evolução de receita não deve sumir/ficar ilegível quando o filtro de data é
    // estreitado pra um período curto. Continua respeitando loja/grupo/marca/tabela de preço.
    // Condição de B2B espelhada de canalWhere("b2b") em core.ts — cliente já atacado só entra
    // como fallback quando ESSA venda não tem tabelaPreco própria (null), não sobrescreve uma
    // venda já classificada como outra tabela.
    prisma.$queryRaw<{ month: Date; units: bigint; revenue: number }[]>`
      SELECT
        date_trunc('month', ("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') AS month,
        SUM("quantidade") AS units,
        SUM("valorTotalLiquido") AS revenue
      FROM "Sale"
      WHERE "storeId" = ANY(${storeIds})
        AND ("tabelaPreco" = 'Tabela atacado' OR ("tabelaPreco" IS NULL AND "clienteNome" = ANY(${b2bClientes})))
        ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
        ${filters.marcas !== undefined ? Prisma.sql`AND "marca" = ANY(${filters.marcas})` : Prisma.empty}
        ${filters.tabelasPreco !== undefined ? Prisma.sql`AND ("tabelaPreco" = ANY(${filters.tabelasPreco}) OR "tabelaPreco" IS NULL)` : Prisma.empty}
      GROUP BY month ORDER BY month ASC
    `,
    prisma.sale.groupBy({
      by: ["grupo", "produto"],
      where,
      _sum: { quantidade: true, valorTotalLiquido: true },
      orderBy: { _sum: { valorTotalLiquido: "desc" } },
      take: 50,
    }),
  ]);

  const pedidos = await prisma.sale.findMany({ where, select: { dapicVendaId: true }, distinct: ["dapicVendaId"] }).then(r => r.length);

  const receita = agg._sum.valorTotalLiquido ?? 0;
  const unidades = agg._sum.quantidade ?? 0;

  return {
    kpis: { receita, pedidos, unidades, ticketMedio: pedidos > 0 ? receita / pedidos : 0 },
    byMonth: byMonthRaw.map(r => ({ month: new Date(r.month).toISOString().slice(0, 7), units: Number(r.units), revenue: Number(r.revenue) })),
    topProdutos: topGrupos.map(r => ({ grupo: r.grupo, produto: r.produto, unidades: r._sum.quantidade ?? 0, receita: r._sum.valorTotalLiquido ?? 0 })),
  };
}

export async function getAtacadoCidades(filters: DashboardFilters) {
  const siteAtacadoIds = await getSiteAtacadoStoreIds();
  if (siteAtacadoIds.length === 0) return { rows: [], totalCidades: 0, totalEstados: 0 };
  const storeIds = filters.storeIds !== undefined ? siteAtacadoIds.filter((id) => filters.storeIds!.includes(id)) : siteAtacadoIds;
  if (storeIds.length === 0) return { rows: [], totalCidades: 0, totalEstados: 0 };

  // Mesmo fix de getAtacadoVendas — cliente já classificado como atacado, não tabelaPreco direto.
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    storeId: { in: storeIds },
    cidade: { not: null },
    AND: [await canalWhere("b2b")],
  };

  const rows = await prisma.sale.groupBy({
    by: ["cidade", "estado"],
    where,
    _sum: { quantidade: true, valorTotalLiquido: true },
    _count: { dapicVendaId: true },
    orderBy: { _sum: { valorTotalLiquido: "desc" } },
  });

  const mapped = rows.map(r => ({
    cidade: r.cidade ?? "—",
    estado: r.estado ?? "—",
    unidades: r._sum.quantidade ?? 0,
    receita: r._sum.valorTotalLiquido ?? 0,
    pedidos: r._count.dapicVendaId,
  }));

  return {
    rows: mapped,
    totalCidades: new Set(mapped.map(r => r.cidade)).size,
    totalEstados: new Set(mapped.map(r => r.estado)).size,
  };
}

export async function getAtacadoClientes(filters: DashboardFilters) {
  const siteAtacadoIds = await getSiteAtacadoStoreIds();
  if (siteAtacadoIds.length === 0) return { rows: [], totalClientes: 0, novosNoPeriodo: 0 };
  const storeIds = filters.storeIds !== undefined ? siteAtacadoIds.filter((id) => filters.storeIds!.includes(id)) : siteAtacadoIds;
  if (storeIds.length === 0) return { rows: [], totalClientes: 0, novosNoPeriodo: 0 };

  // Essa aba é especificamente sobre clientes de ATACADO (B2B) — sem esse filtro, misturava
  // com clientes de varejo do site (mesma loja física "Site+Atacado", canal diferente). Usa
  // canalWhere("b2b") (cliente já classificado como atacado, não só a linha) em vez de
  // tabelaPreco="Tabela atacado" direto — senão o cliente que negocia preço próprio (tabelaPreco
  // null nessas linhas) ficava com pedidos/receita subcontados aqui.
  const b2bWhere = await canalWhere("b2b");
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    storeId: { in: storeIds },
    AND: [b2bWhere],
    clienteNome: { not: null },
  };

  const [rows, primeiraVendaGeral] = await Promise.all([
    prisma.sale.groupBy({
      by: ["clienteNome", "cidade", "estado"],
      where,
      _sum: { quantidade: true, valorTotalLiquido: true },
      _count: { dapicVendaId: true },
      _max: { saleDate: true },
      _min: { saleDate: true },
      orderBy: { _sum: { valorTotalLiquido: "desc" } },
    }),
    prisma.sale.groupBy({
      by: ["clienteNome"],
      where: { ...saleWhere(filters), storeId: { in: storeIds }, AND: [b2bWhere], saleDate: { lt: filters.from }, clienteNome: { not: null } },
      _count: { id: true },
    }),
  ]);

  const clientesAntigos = new Set(primeiraVendaGeral.map(r => r.clienteNome));

  // Telefone — pedido do Rodrigo em 2026-08-28: telefone em toda visão que lista cliente.
  const nomes = [...new Set(rows.map((r) => r.clienteNome).filter((n): n is string => n !== null))];
  const cadastros = await prisma.clienteCadastro.findMany({ where: { nome: { in: nomes } } });
  const cadastroByNome = new Map(cadastros.map((c) => [c.nome, c]));

  const mapped = rows.map(r => ({
    clienteNome: r.clienteNome ?? "—",
    telefone: (r.clienteNome && (cadastroByNome.get(r.clienteNome)?.telefone ?? cadastroByNome.get(r.clienteNome)?.celular)) || null,
    cidade: r.cidade ?? "—",
    estado: r.estado ?? "—",
    pedidos: r._count.dapicVendaId,
    unidades: r._sum.quantidade ?? 0,
    receita: r._sum.valorTotalLiquido ?? 0,
    ultimaCompra: r._max.saleDate,
    primeiraCompra: r._min.saleDate,
    isNovo: !clientesAntigos.has(r.clienteNome),
  }));

  const novosNoPeriodo = mapped.filter(r => r.isNovo).length;

  return { rows: mapped, totalClientes: mapped.length, novosNoPeriodo };
}

// Lista de clientes de atacado (mesmo conjunto que canalWhere("b2b") usa por baixo — cliente
// que já teve QUALQUER venda em "Tabela atacado", classificação por cliente inteiro, não por
// linha) — pedido do Rodrigo em 2026-09-18, pro dropdown "Cliente" em Atacado → Vendas. Reusa o
// cache de 5min de getB2BClienteNomes, não faz query nova.
export async function getAtacadoClienteNomes(): Promise<string[]> {
  return [...(await getB2BClienteNomes())].sort();
}

export type AtacadoClienteEvolucaoMes = { mes: number; receitaAtual: number | null; receitaAnterior: number };

export type AtacadoClienteEvolucaoProduto = {
  produto: string;
  grupo: string;
  unidadesAtual: number;
  receitaAtual: number;
  unidadesAnterior: number;
  receitaAnterior: number;
  pedidos: number;
  ultimaCompra: Date;
  status: "novo" | "perdido" | "normal";
};

export type AtacadoClienteEvolucao = {
  cliente: string;
  anoAtual: number;
  anoAnterior: number;
  // "18/09" — até quando o ano ATUAL foi contado (ano em curso, sempre parcial). O ano anterior
  // conta o ano INTEIRO (ver comentário na função sobre por quê).
  atualAte: string;
  totalAtual: { receita: number; unidades: number; pedidos: number };
  totalAnterior: { receita: number; unidades: number; pedidos: number };
  variacaoReais: number;
  // null = sem base de comparação (0 nos dois anos) ou cliente novo (0 no ano anterior, > 0
  // agora) — nesse 2º caso não faz sentido um "%", vira um selo "Novo" na tela.
  variacaoPercent: number | null;
  meses: AtacadoClienteEvolucaoMes[];
  produtos: AtacadoClienteEvolucaoProduto[];
};

// Evolução ano-a-ano de UM cliente de atacado — pedido do Rodrigo em 2026-09-18: "esse cliente
// comprou quanto no ano passado vs esse ano?". Reusa exatamente o mesmo padrão de
// getClienteFicha (1 fetch de todas as vendas do cliente no período, agrega em JS) — eficiente
// porque é por cliente (linhas limitadas), não a base inteira.
//
// Período: ano ANTERIOR sempre conta INTEIRO (jan-dez); ano ATUAL conta até a data de
// referência (default hoje), sempre parcial. Isso NÃO é "ano parcial vs ano inteiro" da forma
// problemática que dá pra imaginar — é o contrário do que causava confusão: a 1ª versão disso
// comparava período EQUIVALENTE (jan-18/09 nos dois anos), mas o histórico real de vendas do
// Radar só começa em 20/09/2025 — então o corte equivalente pra 2025 caía 2 dias ANTES do
// início da sincronização, e todo cliente aparecia com "2025: R$0,00" mesmo tendo vendido bem
// em out/nov/dez/2025 (achado pelo Rodrigo testando, 2026-09-18). Mostrar o ano anterior
// INTEIRO é o que reflete a venda real que existe. A comparação % fica enviesada a favor do ano
// atual enquanto o histórico de 2025 for parcial (só ~3 meses reais) — a tela avisa isso
// explicitamente, não esconde.
//
// Devolução: NÃO entra aqui de propósito. Devolução no Radar é sempre tratada como B2C (Return
// nem tem campo clienteNome — não dá pra atribuir a um cliente de atacado específico), então
// pra atacado bruta = líquida, mesma regra já usada em getMonthlySnapshotKpi/getAtacadoVendas.
export async function getAtacadoClienteEvolucao(
  clienteNome: string,
  filters: Pick<DashboardFilters, "marcas" | "tabelasPreco" | "grupoIn">,
  referenceDate: Date = new Date()
): Promise<AtacadoClienteEvolucao | null> {
  const siteAtacadoIds = await getSiteAtacadoStoreIds();
  if (siteAtacadoIds.length === 0) return null;

  const hojeStr = todayBrasiliaStr(referenceDate);
  const anoAtual = Number(hojeStr.slice(0, 4));
  const anoAnterior = anoAtual - 1;
  const mmdd = hojeStr.slice(5);

  const fromAtual = brasiliaDayStart(`${anoAtual}-01-01`);
  const toAtual = brasiliaDayEnd(hojeStr);
  const fromAnterior = brasiliaDayStart(`${anoAnterior}-01-01`);

  // Mesma robustez de nome de getClienteFicha — o cadastro tem variação de capitalização entre
  // vendas do mesmo cliente (ex: "Loja X" vs "LOJA X"), então casa por nome normalizado e usa
  // todas as variantes reais encontradas.
  const norm = clienteNome.trim().toUpperCase();
  const variantRows = await prisma.$queryRaw<{ nome: string }[]>`
    SELECT DISTINCT "clienteNome" AS nome FROM "Sale"
    WHERE "storeId" = ANY(${siteAtacadoIds}) AND UPPER(TRIM("clienteNome")) = ${norm}
  `;
  if (variantRows.length === 0) return null;
  const variantes = variantRows.map((r) => r.nome);

  const rangeFilters: DashboardFilters = { ...filters, from: fromAnterior, to: toAtual };
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(rangeFilters),
    storeId: { in: siteAtacadoIds },
    clienteNome: { in: variantes },
  };
  const sales = await prisma.sale.findMany({
    where,
    select: { saleDate: true, dapicVendaId: true, grupo: true, produto: true, quantidade: true, valorTotalLiquido: true },
  });
  if (sales.length === 0) return null;

  const mesAtualNum = Number(mmdd.slice(0, 2));
  const mesesAtualMap = new Map<number, number>();
  const mesesAnteriorMap = new Map<number, number>();
  let totalAtualReceita = 0, totalAtualUnidades = 0;
  const pedidosAtual = new Set<string>();
  let totalAnteriorReceita = 0, totalAnteriorUnidades = 0;
  const pedidosAnterior = new Set<string>();
  const produtoMap = new Map<string, AtacadoClienteEvolucaoProduto & { pedidosSet: Set<string> }>();

  for (const s of sales) {
    const dStr = todayBrasiliaStr(s.saleDate);
    const ano = dStr.slice(0, 4);
    const mes = Number(dStr.slice(5, 7));
    const pedidoKey = String(s.dapicVendaId);
    const noAno = ano === String(anoAtual);
    const noAnoAnterior = ano === String(anoAnterior);

    if (noAno) {
      mesesAtualMap.set(mes, (mesesAtualMap.get(mes) ?? 0) + s.valorTotalLiquido);
      totalAtualReceita += s.valorTotalLiquido;
      totalAtualUnidades += s.quantidade;
      pedidosAtual.add(pedidoKey);
    }
    if (noAnoAnterior) {
      // Ano anterior INTEIRO (jan-dez) — tanto pro gráfico mensal quanto pros totais/cards.
      mesesAnteriorMap.set(mes, (mesesAnteriorMap.get(mes) ?? 0) + s.valorTotalLiquido);
      totalAnteriorReceita += s.valorTotalLiquido;
      totalAnteriorUnidades += s.quantidade;
      pedidosAnterior.add(pedidoKey);
    }

    const p = produtoMap.get(s.produto) ?? {
      produto: s.produto, grupo: s.grupo,
      unidadesAtual: 0, receitaAtual: 0, unidadesAnterior: 0, receitaAnterior: 0,
      pedidos: 0, ultimaCompra: s.saleDate, status: "normal" as const, pedidosSet: new Set<string>(),
    };
    p.pedidosSet.add(pedidoKey);
    if (s.saleDate > p.ultimaCompra) p.ultimaCompra = s.saleDate;
    if (noAno) { p.unidadesAtual += s.quantidade; p.receitaAtual += s.valorTotalLiquido; }
    if (noAnoAnterior) { p.unidadesAnterior += s.quantidade; p.receitaAnterior += s.valorTotalLiquido; }
    produtoMap.set(s.produto, p);
  }

  const meses: AtacadoClienteEvolucaoMes[] = Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    return {
      mes,
      receitaAtual: mes <= mesAtualNum ? (mesesAtualMap.get(mes) ?? 0) : null,
      receitaAnterior: mesesAnteriorMap.get(mes) ?? 0,
    };
  });

  const produtos: AtacadoClienteEvolucaoProduto[] = [...produtoMap.values()]
    .map((p) => ({
      produto: p.produto, grupo: p.grupo,
      unidadesAtual: p.unidadesAtual, receitaAtual: p.receitaAtual,
      unidadesAnterior: p.unidadesAnterior, receitaAnterior: p.receitaAnterior,
      pedidos: p.pedidosSet.size, ultimaCompra: p.ultimaCompra,
      status: (p.receitaAnterior === 0 && p.receitaAtual > 0 ? "novo"
        : p.receitaAtual === 0 && p.receitaAnterior > 0 ? "perdido"
        : "normal") as "novo" | "perdido" | "normal",
    }))
    .sort((a, b) => (b.receitaAtual || b.receitaAnterior) - (a.receitaAtual || a.receitaAnterior));

  const variacaoReais = totalAtualReceita - totalAnteriorReceita;
  const variacaoPercent = totalAnteriorReceita > 0
    ? (variacaoReais / totalAnteriorReceita) * 100
    : totalAtualReceita > 0 ? null : 0;

  return {
    cliente: variantes[0],
    anoAtual, anoAnterior,
    atualAte: mmdd.split("-").reverse().join("/"),
    totalAtual: { receita: totalAtualReceita, unidades: totalAtualUnidades, pedidos: pedidosAtual.size },
    totalAnterior: { receita: totalAnteriorReceita, unidades: totalAnteriorUnidades, pedidos: pedidosAnterior.size },
    variacaoReais, variacaoPercent,
    meses, produtos,
  };
}
