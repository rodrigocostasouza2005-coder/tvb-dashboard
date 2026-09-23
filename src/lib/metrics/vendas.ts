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


export async function getKpiSummary(filters: DashboardFilters) {
  const [salesAgg, stockAgg, returnsAgg] = await Promise.all([
    prisma.sale.aggregate({
      where: saleWhere(filters),
      _sum: { quantidade: true, valorTotalLiquido: true },
    }),
    prisma.stockSnapshot.aggregate({
      where: stockWhere(filters),
      _sum: { quantidadeDisponivel: true },
    }),
    prisma.return.aggregate({
      where: returnWhere(filters),
      _sum: { quantidade: true, valorTotal: true },
    }),
  ]);

  return {
    unitsSold: salesAgg._sum.quantidade ?? 0,
    revenue: salesAgg._sum.valorTotalLiquido ?? 0,
    currentStock: stockAgg._sum.quantidadeDisponivel ?? 0,
    unitsReturned: returnsAgg._sum.quantidade ?? 0,
    valueReturned: returnsAgg._sum.valorTotal ?? 0,
  };
}

// KPIs pra Lâmina Mensal: além de unidades/receita, conta pedidos distintos (pra ticket
// médio = receita líquida / nº de pedidos, não / peças) e separa por canal B2B/B2C.
// Devolução é sempre B2C (confirmado pelo Rodrigo em 2026-08-21, não precisa segmentar por
// tabelaPreco) — então em "todos" e "b2c" o valor devolvido do período inteiro é aplicado
// normalmente; em "b2b" não há devolução nenhuma (líquida = bruta).
export async function getMonthlySnapshotKpi(filters: DashboardFilters, canal: Canal = "todos") {
  const where: Prisma.SaleWhereInput = { AND: [saleWhere(filters), await canalWhere(canal)] };
  const [salesAgg, orderRows, returnsAgg] = await Promise.all([
    prisma.sale.aggregate({ where, _sum: { quantidade: true, valorTotalLiquido: true } }),
    prisma.sale.groupBy({ by: ["storeId", "dapicVendaId"], where }),
    canal === "b2b"
      ? Promise.resolve({ _sum: { quantidade: 0, valorTotal: 0 } })
      : prisma.return.aggregate({ where: returnWhere(filters), _sum: { quantidade: true, valorTotal: true } }),
  ]);

  return {
    unitsBruta: salesAgg._sum.quantidade ?? 0,
    revenueBruta: salesAgg._sum.valorTotalLiquido ?? 0,
    orderCount: orderRows.length,
    unitsReturned: returnsAgg._sum.quantidade ?? 0,
    valueReturned: returnsAgg._sum.valorTotal ?? 0,
  };
}

// Vendas agrupadas por dia (horário de Brasília) dentro do período filtrado — usado pro
// gráfico de tendência da Visão Geral. Agrupar por dia em SQL é mais simples que em JS aqui
// porque saleDate é timestamp; usa AT TIME ZONE pra não cair no dia errado perto da meia-noite
// (mesmo cuidado de fuso já documentado em filters.ts).
// Líquido de devolução (desconta por dia) desde 2026-09-09 — era a única exceção bruta que
// sobrava no dashboard (Rodrigo achou receita de ontem do Barra "errada": R$2200 aqui vs
// R$1853 líquido, diferença batendo exato com 1 devolução do dia). getSalesByDayPerStore já
// era líquido, esse aqui tinha ficado pra trás.
export async function getSalesByDay(filters: DashboardFilters) {
  const [salesRows, returnRows] = await Promise.all([
    prisma.$queryRaw<{ day: Date; units: bigint; revenue: number }[]>`
      SELECT
        (("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date AS day,
        SUM("quantidade") AS units,
        SUM("valorTotalLiquido") AS revenue
      FROM "Sale"
      WHERE "saleDate" >= ${filters.from}
        AND "saleDate" <= ${filters.to}
        ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
        ${filters.marcas !== undefined ? Prisma.sql`AND "marca" = ANY(${filters.marcas})` : Prisma.empty}
        ${filters.tabelasPreco !== undefined ? Prisma.sql`AND ("tabelaPreco" = ANY(${filters.tabelasPreco}) OR "tabelaPreco" IS NULL)` : Prisma.empty}
        ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
        ${filters.colecaoIn ? Prisma.sql`AND "colecao" = ANY(${filters.colecaoIn})` : Prisma.empty}
      GROUP BY day
      ORDER BY day ASC
    `,
    // Return não tem marca/tabelaPreco populado de forma confiável (mesma limitação de
    // returnWhere() no resto do dashboard) — desconta por loja/grupo/data/coleção (coleção com
    // passthrough de null, mesmo motivo do returnWhere()).
    prisma.$queryRaw<{ day: Date; units: bigint; value: number }[]>`
      SELECT
        (("returnDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date AS day,
        SUM("quantidade") AS units,
        SUM("valorTotal") AS value
      FROM "Return"
      WHERE "returnDate" >= ${filters.from}
        AND "returnDate" <= ${filters.to}
        ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
        ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
        ${filters.colecaoIn ? Prisma.sql`AND ("colecao" = ANY(${filters.colecaoIn}) OR "colecao" IS NULL)` : Prisma.empty}
      GROUP BY day
      ORDER BY day ASC
    `,
  ]);

  // O SQL acima já resolveu o dia certo em horário de Brasília e devolveu como DATE — o driver
  // do Postgres traz DATE como Date em meia-noite UTC. Reformatar essa data usando timeZone
  // America/Sao_Paulo aqui jogaria pro dia anterior (meia-noite UTC = 21h do dia anterior em
  // Brasília), o mesmo tipo de bug de fuso já visto nesse projeto — por isso lê direto em UTC.
  const byDay = new Map<string, { unitsSold: number; revenue: number }>();
  for (const r of salesRows) {
    const day = new Date(r.day).toISOString().slice(0, 10);
    byDay.set(day, { unitsSold: Number(r.units), revenue: Number(r.revenue) });
  }
  for (const r of returnRows) {
    const day = new Date(r.day).toISOString().slice(0, 10);
    const cur = byDay.get(day) ?? { unitsSold: 0, revenue: 0 };
    cur.unitsSold -= Number(r.units);
    cur.revenue -= Number(r.value);
    byDay.set(day, cur);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, ...v }));
}

// Mesma ideia de getSalesByDay, mas quebrado por loja — pro gráfico de comparação de lojas
// da Visão Geral. Agrupa por displayGroup (ex: ATACADO + Site viram uma série só "TVB Site e
// Atacado"), igual o filtro de loja já faz, senão a mesma operação apareceria duplicada.
// Líquido (desconta devolução por dia+loja) — pedido do Rodrigo em 2026-08-31, achou que o
// "Comparativo entre lojas" da Visão Geral estava bruto (estava mesmo — só somava Sale.quantidade
// sem descontar Return, diferente do resto do dashboard que já é líquido em todo lugar).
export async function getSalesByDayPerStore(filters: DashboardFilters) {
  const [salesRows, returnRows] = await Promise.all([
    prisma.$queryRaw<{ day: Date; storeId: string; units: bigint }[]>`
      SELECT
        (("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date AS day,
        "storeId",
        SUM("quantidade") AS units
      FROM "Sale"
      WHERE "saleDate" >= ${filters.from}
        AND "saleDate" <= ${filters.to}
        ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
        ${filters.marcas !== undefined ? Prisma.sql`AND "marca" = ANY(${filters.marcas})` : Prisma.empty}
        ${filters.tabelasPreco !== undefined ? Prisma.sql`AND ("tabelaPreco" = ANY(${filters.tabelasPreco}) OR "tabelaPreco" IS NULL)` : Prisma.empty}
        ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
        ${filters.colecaoIn ? Prisma.sql`AND "colecao" = ANY(${filters.colecaoIn})` : Prisma.empty}
      GROUP BY day, "storeId"
      ORDER BY day ASC
    `,
    // Return não tem marca/tabelaPreco populado de forma confiável (mesmo motivo/limitação já
    // documentada em returnWhere()) — filtra por loja/grupo/data/coleção (coleção com passthrough
    // de null, mesmo motivo do returnWhere()).
    prisma.$queryRaw<{ day: Date; storeId: string; units: bigint }[]>`
      SELECT
        (("returnDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date AS day,
        "storeId",
        SUM("quantidade") AS units
      FROM "Return"
      WHERE "returnDate" >= ${filters.from}
        AND "returnDate" <= ${filters.to}
        ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
        ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
        ${filters.colecaoIn ? Prisma.sql`AND ("colecao" = ANY(${filters.colecaoIn}) OR "colecao" IS NULL)` : Prisma.empty}
      GROUP BY day, "storeId"
      ORDER BY day ASC
    `,
  ]);

  const stores = await prisma.store.findMany({ where: { sellsProducts: true } });
  const seriesNameByStoreId = new Map(stores.map((s) => [s.id, s.displayGroup ?? s.name]));

  const byDay = new Map<string, Record<string, number>>();
  const seriesNames = new Set<string>();
  for (const r of salesRows) {
    const seriesName = seriesNameByStoreId.get(r.storeId);
    if (!seriesName) continue; // loja que não vende (armazém/CD) não deveria ter Sale, ignora por segurança
    const day = new Date(r.day).toISOString().slice(0, 10);
    seriesNames.add(seriesName);
    const dayRow = byDay.get(day) ?? {};
    dayRow[seriesName] = (dayRow[seriesName] ?? 0) + Number(r.units);
    byDay.set(day, dayRow);
  }
  for (const r of returnRows) {
    const seriesName = seriesNameByStoreId.get(r.storeId);
    if (!seriesName) continue;
    const day = new Date(r.day).toISOString().slice(0, 10);
    const dayRow = byDay.get(day) ?? {};
    dayRow[seriesName] = (dayRow[seriesName] ?? 0) - Number(r.units);
    byDay.set(day, dayRow);
  }

  const series = [...seriesNames].sort();
  const data = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, values]) => ({ day, ...values }));

  return { data, series };
}

// Mesma ideia de getSalesByDayPerStore, mas quebrado por coleção em vez de loja — pedido do
// Rodrigo em 2026-09-14: o comparativo de coleção virar linha do tempo (StoreCompareChart), não
// só um ranking de barra do total do período. Líquido (desconta devolução por dia+coleção).
export async function getSalesByDayPerColecao(filters: DashboardFilters) {
  const [salesRows, returnRows] = await Promise.all([
    prisma.$queryRaw<{ day: Date; colecao: string | null; units: bigint }[]>`
      SELECT
        (("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date AS day,
        "colecao",
        SUM("quantidade") AS units
      FROM "Sale"
      WHERE "saleDate" >= ${filters.from}
        AND "saleDate" <= ${filters.to}
        ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
        ${filters.marcas !== undefined ? Prisma.sql`AND "marca" = ANY(${filters.marcas})` : Prisma.empty}
        ${filters.tabelasPreco !== undefined ? Prisma.sql`AND ("tabelaPreco" = ANY(${filters.tabelasPreco}) OR "tabelaPreco" IS NULL)` : Prisma.empty}
        ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
        ${filters.colecaoIn ? Prisma.sql`AND "colecao" = ANY(${filters.colecaoIn})` : Prisma.empty}
      GROUP BY day, "colecao"
      ORDER BY day ASC
    `,
    prisma.$queryRaw<{ day: Date; colecao: string | null; units: bigint }[]>`
      SELECT
        (("returnDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date AS day,
        "colecao",
        SUM("quantidade") AS units
      FROM "Return"
      WHERE "returnDate" >= ${filters.from}
        AND "returnDate" <= ${filters.to}
        ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
        ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
        ${filters.colecaoIn ? Prisma.sql`AND ("colecao" = ANY(${filters.colecaoIn}) OR "colecao" IS NULL)` : Prisma.empty}
      GROUP BY day, "colecao"
      ORDER BY day ASC
    `,
  ]);

  const byDay = new Map<string, Record<string, number>>();
  const seriesNames = new Set<string>();
  for (const r of salesRows) {
    const seriesName = r.colecao?.trim() || "(sem coleção)";
    const day = new Date(r.day).toISOString().slice(0, 10);
    seriesNames.add(seriesName);
    const dayRow = byDay.get(day) ?? {};
    dayRow[seriesName] = (dayRow[seriesName] ?? 0) + Number(r.units);
    byDay.set(day, dayRow);
  }
  for (const r of returnRows) {
    const seriesName = r.colecao?.trim() || "(sem coleção)";
    const day = new Date(r.day).toISOString().slice(0, 10);
    const dayRow = byDay.get(day) ?? {};
    dayRow[seriesName] = (dayRow[seriesName] ?? 0) - Number(r.units);
    byDay.set(day, dayRow);
  }

  const series = [...seriesNames].sort();
  const data = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, values]) => ({ day, ...values }));

  return { data, series };
}

async function groupSalesByDimension(dimension: Dimension, where: Prisma.SaleWhereInput) {
  switch (dimension) {
    case "grupo":
      return prisma.sale.groupBy({ by: ["grupo"], where, _sum: { quantidade: true, valorTotalLiquido: true } });
    case "produto":
      return prisma.sale.groupBy({ by: ["produto"], where, _sum: { quantidade: true, valorTotalLiquido: true } });
    case "tamanho":
      return prisma.sale.groupBy({ by: ["tamanho"], where, _sum: { quantidade: true, valorTotalLiquido: true } });
    case "colecao":
      return prisma.sale.groupBy({ by: ["colecao"], where, _sum: { quantidade: true, valorTotalLiquido: true } });
  }
}

export async function getSalesByDimension(filters: DashboardFilters, dimension: Dimension = "grupo", canal: Canal = "todos") {
  const where: Prisma.SaleWhereInput = canal === "todos" ? saleWhere(filters) : { AND: [saleWhere(filters), await canalWhere(canal)] };
  const rows = await groupSalesByDimension(dimension, where);
  return rows
    .map((r) => ({
      key: dimensionKey(dimension, r),
      unitsSold: r._sum.quantidade ?? 0,
      revenue: r._sum.valorTotalLiquido ?? 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

async function groupSalesByStoreAndDimension(dimension: Dimension, where: Prisma.SaleWhereInput) {
  switch (dimension) {
    case "grupo":
      return prisma.sale.groupBy({ by: ["storeId", "grupo"], where, _sum: { quantidade: true, valorTotalLiquido: true } });
    case "produto":
      return prisma.sale.groupBy({ by: ["storeId", "produto"], where, _sum: { quantidade: true, valorTotalLiquido: true } });
    case "tamanho":
      return prisma.sale.groupBy({ by: ["storeId", "tamanho"], where, _sum: { quantidade: true, valorTotalLiquido: true } });
    case "colecao":
      return prisma.sale.groupBy({ by: ["storeId", "colecao"], where, _sum: { quantidade: true, valorTotalLiquido: true } });
  }
}

// Vendas quebradas por loja (1 linha por loja, não uma dimensão de produto) — pedido pras
// integrações externas (MCP/GPT), que só tinham "loja" como filtro (1 de cada vez), sem jeito de
// pedir a quebra por todas as lojas numa resposta só. "dimension" opcional cruza loja × grupo/
// produto/tamanho/colecao (2026-09-09, mesmo pedido: "só total por loja, sem cruzar com produto").
// "pedidos" conta pedido distinto (storeId+dapicVendaId), igual getTopClientes — não é linha de
// item, pra ticketMedio não inflar em pedido com vários produtos.
export async function getSalesByStore(filters: DashboardFilters, canal: Canal = "todos", dimension?: Dimension) {
  const where: Prisma.SaleWhereInput = canal === "todos" ? saleWhere(filters) : { AND: [saleWhere(filters), await canalWhere(canal)] };

  const [stores, pedidosRows] = await Promise.all([
    prisma.store.findMany({ where: { sellsProducts: true } }),
    prisma.sale.groupBy({ by: ["storeId", "dapicVendaId"], where }),
  ]);
  const nameById = new Map(stores.map((s) => [s.id, s.displayGroup ?? s.name]));

  const pedidosByNome = new Map<string, Set<string>>();
  for (const p of pedidosRows) {
    const nome = nameById.get(p.storeId) ?? p.storeId;
    const set = pedidosByNome.get(nome) ?? new Set<string>();
    set.add(`${p.storeId}::${p.dapicVendaId}`);
    pedidosByNome.set(nome, set);
  }

  if (dimension) {
    const rows = await groupSalesByStoreAndDimension(dimension, where);
    const byNome = new Map<string, { key: string; unidades: number; receita: number }[]>();
    for (const r of rows) {
      const nome = nameById.get(r.storeId) ?? r.storeId;
      const key = dimensionKey(dimension, r as Parameters<typeof dimensionKey>[1]);
      const arr = byNome.get(nome) ?? [];
      arr.push({ key, unidades: r._sum.quantidade ?? 0, receita: r._sum.valorTotalLiquido ?? 0 });
      byNome.set(nome, arr);
    }
    return [...byNome.entries()]
      .map(([loja, itens]) => ({
        loja,
        pedidos: pedidosByNome.get(loja)?.size ?? 0,
        itens: itens.sort((a, b) => b.receita - a.receita),
      }))
      .sort(
        (a, b) => b.itens.reduce((s, i) => s + i.receita, 0) - a.itens.reduce((s, i) => s + i.receita, 0)
      );
  }

  const rows = await prisma.sale.groupBy({ by: ["storeId"], where, _sum: { quantidade: true, valorTotalLiquido: true } });
  const merged = new Map<string, { loja: string; unidades: number; receita: number }>();
  for (const r of rows) {
    const nome = nameById.get(r.storeId) ?? r.storeId;
    const cur = merged.get(nome) ?? { loja: nome, unidades: 0, receita: 0 };
    cur.unidades += r._sum.quantidade ?? 0;
    cur.receita += r._sum.valorTotalLiquido ?? 0;
    merged.set(nome, cur);
  }
  return [...merged.values()]
    .map((m) => {
      const pedidos = pedidosByNome.get(m.loja)?.size ?? 0;
      return { ...m, pedidos, ticketMedio: pedidos > 0 ? m.receita / pedidos : 0 };
    })
    .sort((a, b) => b.receita - a.receita);
}

// Vendas por produto, com o grupo de cada um junto — usado pra "abrir" um grupo na aba Vendas
// e ver os produtos dele, sem precisar de uma chamada nova por grupo clicado.
export async function getSalesByGrupoProduto(filters: DashboardFilters) {
  const rows = await prisma.sale.groupBy({
    by: ["grupo", "produto"],
    where: saleWhere(filters),
    _sum: { quantidade: true, valorTotalLiquido: true },
  });
  return rows
    .map((r) => ({
      grupo: r.grupo,
      key: r.produto,
      unitsSold: r._sum.quantidade ?? 0,
      revenue: r._sum.valorTotalLiquido ?? 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

// Vendas por tamanho dentro de cada grupo+produto — 3º nível: grupo → produto → tamanho
export async function getSalesByGrupoProdutoTamanho(filters: DashboardFilters) {
  const rows = await prisma.sale.groupBy({
    by: ["grupo", "produto", "tamanho"],
    where: saleWhere(filters),
    _sum: { quantidade: true, valorTotalLiquido: true },
  });
  return rows.map((r) => ({
    grupo: r.grupo,
    produto: r.produto,
    key: r.tamanho ?? "—",
    unitsSold: r._sum.quantidade ?? 0,
    revenue: r._sum.valorTotalLiquido ?? 0,
  }));
}

// Devoluções por tamanho dentro de cada grupo+produto — 3º nível
export async function getReturnsByGrupoProdutoTamanho(filters: DashboardFilters) {
  const rows = await prisma.return.groupBy({
    by: ["grupo", "produto", "tamanho"],
    where: returnWhere(filters),
    _sum: { quantidade: true, valorTotal: true },
  });
  return rows.map((r) => ({
    grupo: r.grupo,
    produto: r.produto,
    key: r.tamanho ?? "—",
    unitsReturned: r._sum.quantidade ?? 0,
    value: r._sum.valorTotal ?? 0,
  }));
}

// Vendas por produto dentro de cada tamanho — expandir tamanho → produtos
export async function getSalesByTamanhoProduto(filters: DashboardFilters) {
  const rows = await prisma.sale.groupBy({
    by: ["tamanho", "produto"],
    where: saleWhere(filters),
    _sum: { quantidade: true, valorTotalLiquido: true },
  });
  return rows
    .map((r) => ({
      grupo: r.tamanho ?? "—",
      key: r.produto,
      unitsSold: r._sum.quantidade ?? 0,
      revenue: r._sum.valorTotalLiquido ?? 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

// Vendas por tamanho dentro de cada produto — expandir produto → tamanhos
export async function getSalesByProdutoTamanho(filters: DashboardFilters) {
  const rows = await prisma.sale.groupBy({
    by: ["produto", "tamanho"],
    where: saleWhere(filters),
    _sum: { quantidade: true, valorTotalLiquido: true },
  });
  return rows
    .map((r) => ({
      grupo: r.produto,
      key: r.tamanho ?? "—",
      unitsSold: r._sum.quantidade ?? 0,
      revenue: r._sum.valorTotalLiquido ?? 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

// Devoluções por produto dentro de cada grupo — expandir grupo → produtos
export async function getReturnsByGrupoProduto(filters: DashboardFilters) {
  const rows = await prisma.return.groupBy({
    by: ["grupo", "produto"],
    where: returnWhere(filters),
    _sum: { quantidade: true, valorTotal: true },
  });
  return rows
    .map((r) => ({
      grupo: r.grupo,
      key: r.produto,
      unitsReturned: r._sum.quantidade ?? 0,
      value: r._sum.valorTotal ?? 0,
    }))
    .sort((a, b) => b.unitsReturned - a.unitsReturned);
}

// Devoluções por produto dentro de cada tamanho — expandir tamanho → produtos
export async function getReturnsByTamanhoProduto(filters: DashboardFilters) {
  const rows = await prisma.return.groupBy({
    by: ["tamanho", "produto"],
    where: returnWhere(filters),
    _sum: { quantidade: true, valorTotal: true },
  });
  return rows
    .map((r) => ({
      grupo: r.tamanho ?? "—",
      key: r.produto,
      unitsReturned: r._sum.quantidade ?? 0,
      value: r._sum.valorTotal ?? 0,
    }))
    .sort((a, b) => b.unitsReturned - a.unitsReturned);
}

// Devoluções por tamanho dentro de cada produto — expandir produto → tamanhos
export async function getReturnsByProdutoTamanho(filters: DashboardFilters) {
  const rows = await prisma.return.groupBy({
    by: ["produto", "tamanho"],
    where: returnWhere(filters),
    _sum: { quantidade: true, valorTotal: true },
  });
  return rows
    .map((r) => ({
      grupo: r.produto,
      key: r.tamanho ?? "—",
      unitsReturned: r._sum.quantidade ?? 0,
      value: r._sum.valorTotal ?? 0,
    }))
    .sort((a, b) => b.unitsReturned - a.unitsReturned);
}

function giftWhere(filters: DashboardFilters): Prisma.GiftWhereInput {
  return {
    giftDate: { gte: filters.from, lte: filters.to },
    ...(filters.storeIds !== undefined ? { storeId: { in: filters.storeIds } } : {}),
    ...(filters.marcas !== undefined ? { marca: { in: filters.marcas } } : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
  };
}

async function groupGiftsByDimension(dimension: Dimension, where: Prisma.GiftWhereInput) {
  switch (dimension) {
    case "grupo":
      return prisma.gift.groupBy({ by: ["grupo"], where, _sum: { quantidade: true, valorTotalLiquido: true } });
    case "produto":
      return prisma.gift.groupBy({ by: ["produto"], where, _sum: { quantidade: true, valorTotalLiquido: true } });
    case "tamanho":
      return prisma.gift.groupBy({ by: ["tamanho"], where, _sum: { quantidade: true, valorTotalLiquido: true } });
    case "colecao":
      return prisma.gift.groupBy({ by: ["colecao"], where, _sum: { quantidade: true, valorTotalLiquido: true } });
  }
}

export async function getGiftsByDimension(filters: DashboardFilters, dimension: Dimension = "grupo") {
  const rows = await groupGiftsByDimension(dimension, giftWhere(filters));
  return rows
    .map((r) => ({
      key: dimensionKey(dimension, r),
      unitsSold: r._sum.quantidade ?? 0,
      revenue: r._sum.valorTotalLiquido ?? 0,
    }))
    .sort((a, b) => b.unitsSold - a.unitsSold);
}

// Mesmo padrão de getSalesByGrupoProduto — usado pra "abrir" um grupo na aba Brinde.
export async function getGiftsByGrupoProduto(filters: DashboardFilters) {
  const rows = await prisma.gift.groupBy({
    by: ["grupo", "produto"],
    where: giftWhere(filters),
    _sum: { quantidade: true, valorTotalLiquido: true },
  });
  return rows
    .map((r) => ({
      grupo: r.grupo,
      key: r.produto,
      unitsSold: r._sum.quantidade ?? 0,
      revenue: r._sum.valorTotalLiquido ?? 0,
    }))
    .sort((a, b) => b.unitsSold - a.unitsSold);
}

async function groupReturnsByDimension(dimension: Dimension, where: Prisma.ReturnWhereInput) {
  switch (dimension) {
    case "grupo":
      return prisma.return.groupBy({ by: ["grupo"], where, _sum: { quantidade: true, valorTotal: true } });
    case "produto":
      return prisma.return.groupBy({ by: ["produto"], where, _sum: { quantidade: true, valorTotal: true } });
    case "tamanho":
      return prisma.return.groupBy({ by: ["tamanho"], where, _sum: { quantidade: true, valorTotal: true } });
    case "colecao":
      // Return não tem campo colecao — retorna vazio para evitar erro de tipo.
      return [] as Awaited<ReturnType<typeof prisma.return.groupBy>>;
  }
}

export async function getReturnsByDimension(filters: DashboardFilters, dimension: Dimension = "grupo") {
  const rows = await groupReturnsByDimension(dimension, returnWhere(filters));
  return rows
    .map((r) => ({
      key: dimensionKey(dimension, r as Parameters<typeof dimensionKey>[1]),
      unitsReturned: (r._sum?.quantidade ?? 0),
      value: (r._sum?.valorTotal ?? 0),
    }))
    .sort((a, b) => b.unitsReturned - a.unitsReturned);
}

// Devoluções agrupadas por dia — usado no gráfico de tendência de devoluções na aba Vendas.
export async function getReturnsByDay(filters: DashboardFilters) {
  const rows = await prisma.$queryRaw<{ day: Date; units: bigint; value: number }[]>`
    SELECT
      (("returnDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      SUM("quantidade") AS units,
      SUM("valorTotal") AS value
    FROM "Return"
    WHERE "returnDate" >= ${filters.from}
      AND "returnDate" <= ${filters.to}
      ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
      ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
    GROUP BY day
    ORDER BY day ASC
  `;
  return rows.map((r) => ({
    day: new Date(r.day).toISOString().slice(0, 10),
    unitsReturned: Number(r.units),
    value: Number(r.value),
  }));
}

// Devoluções não têm vendedor no schema, mas dapicVendaId é o mesmo id da venda original —
// junta de volta com Sale (storeId+dapicVendaId) pra descobrir de qual vendedor foi cada
// devolução. Chave storeId::vendedor porque o mesmo vendedor pode aparecer em mais de uma loja.
async function getDevolvidoPorVendedor(filters: Pick<DashboardFilters, "storeIds" | "grupoIn" | "from" | "to">) {
  const returns = await prisma.return.findMany({
    where: { ...returnWhere(filters), dapicVendaId: { not: null } },
    select: { storeId: true, dapicVendaId: true, valorTotal: true, quantidade: true },
  });
  if (returns.length === 0) return new Map<string, { valor: number; unidades: number }>();

  const dapicVendaIds = [...new Set(returns.map((r) => r.dapicVendaId as number))];
  const storeIds = [...new Set(returns.map((r) => r.storeId))];
  const sales = await prisma.sale.findMany({
    where: { storeId: { in: storeIds }, dapicVendaId: { in: dapicVendaIds }, vendedor: { not: null } },
    select: { storeId: true, dapicVendaId: true, vendedor: true },
  });
  const vendedorByVenda = new Map(sales.map((s) => [`${s.storeId}::${s.dapicVendaId}`, s.vendedor as string]));

  const devolvidoPorVendedor = new Map<string, { valor: number; unidades: number }>();
  for (const r of returns) {
    const vendedor = vendedorByVenda.get(`${r.storeId}::${r.dapicVendaId}`);
    if (!vendedor) continue;
    const key = `${r.storeId}::${vendedor}`;
    const cur = devolvidoPorVendedor.get(key) ?? { valor: 0, unidades: 0 };
    devolvidoPorVendedor.set(key, { valor: cur.valor + r.valorTotal, unidades: cur.unidades + r.quantidade });
  }
  return devolvidoPorVendedor;
}

export async function getVendedorRanking(filters: DashboardFilters) {
  const [rows, devolvidoPorVendedor] = await Promise.all([
    prisma.sale.groupBy({
      by: ["storeId", "vendedor"],
      where: { ...saleWhere(filters), vendedor: { not: null } },
      _sum: { quantidade: true, valorTotalLiquido: true },
      _count: { _all: true },
    }),
    getDevolvidoPorVendedor(filters),
  ]);

  const storeIds = [...new Set(rows.map((r) => r.storeId))];
  const stores = await prisma.store.findMany({ where: { id: { in: storeIds } } });
  const storeName = new Map(stores.map((s) => [s.id, s.name]));

  return rows
    .map((r) => {
      const receitaBruta = r._sum.valorTotalLiquido ?? 0;
      const unidadesBrutas = r._sum.quantidade ?? 0;
      const devolvido = devolvidoPorVendedor.get(`${r.storeId}::${r.vendedor}`) ?? { valor: 0, unidades: 0 };
      return {
        vendedor: r.vendedor as string,
        storeName: storeName.get(r.storeId) ?? r.storeId,
        pedidos: r._count._all,
        unidadesBrutas,
        unidadesLiquidas: unidadesBrutas - devolvido.unidades,
        receitaBruta,
        receitaLiquida: receitaBruta - devolvido.valor,
      };
    })
    .sort((a, b) => b.receitaBruta - a.receitaBruta);
}

export async function getMonthlySalesByStore(filters: DashboardFilters, canal: Canal = "todos") {
  // Cliente já classificado como atacado (mesma regra de canalWhere) conta em "b2b" mesmo em
  // linhas com tabelaPreco null (preço negociado) — sem isso, cliente atacado que negocia preço
  // ficava subcontado aqui.
  const b2bClientes = canal !== "todos" ? [...(await getB2BClienteNomes())] : [];
  const rows = await prisma.$queryRaw<{ month: Date; storeId: string; units: bigint; revenue: number }[]>`
    SELECT
      DATE_TRUNC('month', ("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') AS month,
      "storeId",
      SUM("quantidade") AS units,
      SUM("valorTotalLiquido") AS revenue
    FROM "Sale"
    WHERE "saleDate" >= ${filters.from}
      AND "saleDate" <= ${filters.to}
      ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
      ${filters.marcas !== undefined ? Prisma.sql`AND "marca" = ANY(${filters.marcas})` : Prisma.empty}
      ${filters.tabelasPreco !== undefined ? Prisma.sql`AND ("tabelaPreco" = ANY(${filters.tabelasPreco}) OR "tabelaPreco" IS NULL)` : Prisma.empty}
      ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
      ${canal === "b2b" ? Prisma.sql`AND ("tabelaPreco" = 'Tabela atacado' OR "clienteNome" = ANY(${b2bClientes}))` : Prisma.empty}
      ${canal === "b2c" ? Prisma.sql`AND "tabelaPreco" IS DISTINCT FROM 'Tabela atacado' AND ("clienteNome" IS NULL OR "clienteNome" <> ALL(${b2bClientes}))` : Prisma.empty}
    GROUP BY month, "storeId"
    ORDER BY month ASC
  `;

  const stores = await prisma.store.findMany({ where: { sellsProducts: true } });
  const seriesNameByStoreId = new Map(stores.map((s) => [s.id, s.displayGroup ?? s.name]));

  // Agrupa por mês e loja (juntando lojas com mesmo displayGroup)
  const byMonth = new Map<string, Record<string, number>>();
  const seriesNames = new Set<string>();

  for (const r of rows) {
    const storeName = seriesNameByStoreId.get(r.storeId);
    if (!storeName) continue;
    const monthStr = new Date(r.month).toISOString().slice(0, 7); // "YYYY-MM"
    seriesNames.add(storeName);
    const monthRow = byMonth.get(monthStr) ?? {};
    monthRow[storeName] = (monthRow[storeName] ?? 0) + Number(r.revenue);
    byMonth.set(monthStr, monthRow);
  }

  // Mesmo para unidades
  const byMonthUnits = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const storeName = seriesNameByStoreId.get(r.storeId);
    if (!storeName) continue;
    const monthStr = new Date(r.month).toISOString().slice(0, 7);
    const monthRow = byMonthUnits.get(monthStr) ?? {};
    monthRow[storeName] = (monthRow[storeName] ?? 0) + Number(r.units);
    byMonthUnits.set(monthStr, monthRow);
  }

  const series = [...seriesNames].sort();
  const months = [...byMonth.keys()].sort();

  const data = months.map((month) => ({
    month,
    revenue: byMonth.get(month) ?? {},
    units: byMonthUnits.get(month) ?? {},
  }));

  return { data, series };
}

// Vendas mensais por Família (= "grupo" no schema, mesmo campo usado em toda a aplicação — não
// existe um campo "família" separado no DAPIC/banco). Mesmo padrão de query/agregação de
// getMonthlySalesByStore acima, só trocando a dimensão (grupo em vez de loja) — pedido do Rodrigo
// em 2026-09-23 ("Vendas mensais por família de produto"), reaproveitando a mesma lógica de
// bucket de mês + unidades/receita já validada ali, sem duplicar a fórmula.
export async function getMonthlySalesByGrupo(filters: DashboardFilters, canal: Canal = "todos") {
  const b2bClientes = canal !== "todos" ? [...(await getB2BClienteNomes())] : [];
  const rows = await prisma.$queryRaw<{ month: Date; grupo: string; units: bigint; revenue: number }[]>`
    SELECT
      DATE_TRUNC('month', ("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') AS month,
      "grupo",
      SUM("quantidade") AS units,
      SUM("valorTotalLiquido") AS revenue
    FROM "Sale"
    WHERE "saleDate" >= ${filters.from}
      AND "saleDate" <= ${filters.to}
      ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
      ${filters.marcas !== undefined ? Prisma.sql`AND "marca" = ANY(${filters.marcas})` : Prisma.empty}
      ${filters.tabelasPreco !== undefined ? Prisma.sql`AND ("tabelaPreco" = ANY(${filters.tabelasPreco}) OR "tabelaPreco" IS NULL)` : Prisma.empty}
      ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
      ${canal === "b2b" ? Prisma.sql`AND ("tabelaPreco" = 'Tabela atacado' OR "clienteNome" = ANY(${b2bClientes}))` : Prisma.empty}
      ${canal === "b2c" ? Prisma.sql`AND "tabelaPreco" IS DISTINCT FROM 'Tabela atacado' AND ("clienteNome" IS NULL OR "clienteNome" <> ALL(${b2bClientes}))` : Prisma.empty}
    GROUP BY month, "grupo"
    ORDER BY month ASC
  `;

  const byMonth = new Map<string, Record<string, number>>();
  const byMonthUnits = new Map<string, Record<string, number>>();
  const gruposSet = new Set<string>();

  for (const r of rows) {
    const monthStr = new Date(r.month).toISOString().slice(0, 7); // "YYYY-MM"
    gruposSet.add(r.grupo);
    const monthRow = byMonth.get(monthStr) ?? {};
    monthRow[r.grupo] = (monthRow[r.grupo] ?? 0) + Number(r.revenue);
    byMonth.set(monthStr, monthRow);
    const monthRowUnits = byMonthUnits.get(monthStr) ?? {};
    monthRowUnits[r.grupo] = (monthRowUnits[r.grupo] ?? 0) + Number(r.units);
    byMonthUnits.set(monthStr, monthRowUnits);
  }

  const series = [...gruposSet].sort();
  const months = [...byMonth.keys()].sort();

  const data = months.map((month) => ({
    month,
    revenue: byMonth.get(month) ?? {},
    units: byMonthUnits.get(month) ?? {},
  }));

  return { data, series };
}

export type DailyProdutoPoint = {
  day: string;
  unitsBruta: number;
  unitsLiquida: number;
  revenueBruta: number;
  revenueLiquida: number;
};

// "Indicadores no Tempo" por produto específico — pedido do Rodrigo em 2026-08-31: escolher um
// produto e ver a evolução dia a dia dele (mesmo range da página, desde set/2025; trocado de
// mês pra dia a pedido do Rodrigo logo em seguida). Mesmo padrão de getSalesByDayPerStore, mas
// filtrado por produto e já líquido (desconta devolução por dia).
export async function getDailySalesByProduto(
  filters: Pick<DashboardFilters, "storeIds" | "marcas" | "tabelasPreco" | "grupoIn" | "from" | "to">,
  produto: string,
  canal: Canal = "todos"
): Promise<DailyProdutoPoint[]> {
  // Cliente já classificado como atacado (mesma regra de canalWhere) conta em "b2b" mesmo em
  // linhas com tabelaPreco null (preço negociado).
  const b2bClientes = canal !== "todos" ? [...(await getB2BClienteNomes())] : [];
  const [salesRows, returnRows] = await Promise.all([
    prisma.$queryRaw<{ day: Date; units: bigint; revenue: number }[]>`
      SELECT
        DATE_TRUNC('day', ("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') AS day,
        SUM("quantidade") AS units,
        SUM("valorTotalLiquido") AS revenue
      FROM "Sale"
      WHERE "produto" = ${produto}
        AND "saleDate" >= ${filters.from}
        AND "saleDate" <= ${filters.to}
        ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
        ${filters.marcas !== undefined ? Prisma.sql`AND "marca" = ANY(${filters.marcas})` : Prisma.empty}
        ${filters.tabelasPreco !== undefined ? Prisma.sql`AND ("tabelaPreco" = ANY(${filters.tabelasPreco}) OR "tabelaPreco" IS NULL)` : Prisma.empty}
        ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
        ${canal === "b2b" ? Prisma.sql`AND ("tabelaPreco" = 'Tabela atacado' OR "clienteNome" = ANY(${b2bClientes}))` : Prisma.empty}
        ${canal === "b2c" ? Prisma.sql`AND "tabelaPreco" IS DISTINCT FROM 'Tabela atacado' AND ("clienteNome" IS NULL OR "clienteNome" <> ALL(${b2bClientes}))` : Prisma.empty}
      GROUP BY day
      ORDER BY day ASC
    `,
    // Devolução é sempre B2C (confirmado pelo Rodrigo) — em canal="b2b" não existe, mas a query
    // já vem vazia naturalmente (produto de venda B2B raramente aparece em Return; não vale a
    // pena um if extra só por isso, o merge abaixo já trata ausência como 0).
    prisma.$queryRaw<{ day: Date; units: bigint; value: number }[]>`
      SELECT
        DATE_TRUNC('day', ("returnDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') AS day,
        SUM("quantidade") AS units,
        SUM("valorTotal") AS value
      FROM "Return"
      WHERE "produto" = ${produto}
        AND "returnDate" >= ${filters.from}
        AND "returnDate" <= ${filters.to}
        ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
        ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
      GROUP BY day
      ORDER BY day ASC
    `,
  ]);

  const byDay = new Map<string, DailyProdutoPoint>();
  for (const r of salesRows) {
    const day = new Date(r.day).toISOString().slice(0, 10);
    const cur = byDay.get(day) ?? { day, unitsBruta: 0, unitsLiquida: 0, revenueBruta: 0, revenueLiquida: 0 };
    cur.unitsBruta += Number(r.units);
    cur.unitsLiquida += Number(r.units);
    cur.revenueBruta += Number(r.revenue);
    cur.revenueLiquida += Number(r.revenue);
    byDay.set(day, cur);
  }
  for (const r of returnRows) {
    const day = new Date(r.day).toISOString().slice(0, 10);
    const cur = byDay.get(day);
    if (!cur) continue;
    cur.unitsLiquida -= Number(r.units);
    cur.revenueLiquida -= Number(r.value);
  }

  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// Devolução total por mês (sem quebrar por loja) — usado pra netar a tendência de receita da
// Lâmina Mensal contra bruta. Devolução é sempre B2C (confirmado pelo Rodrigo), então quando
// canal="b2b" o chamador nem chama isso (líquida = bruta nesse caso).
export async function getMonthlyReturnsTotal(filters: Pick<DashboardFilters, "storeIds" | "grupoIn" | "from" | "to">) {
  const rows = await prisma.$queryRaw<{ month: Date; value: number }[]>`
    SELECT
      DATE_TRUNC('month', ("returnDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') AS month,
      SUM("valorTotal") AS value
    FROM "Return"
    WHERE "returnDate" >= ${filters.from}
      AND "returnDate" <= ${filters.to}
      ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
      ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
    GROUP BY month
    ORDER BY month ASC
  `;
  return new Map(rows.map((r) => [new Date(r.month).toISOString().slice(0, 7), Number(r.value)]));
}

// Top clientes por brindes recebidos — agrupado por clienteNome na tabela Gift.
// Só existe histórico de clienteNome nos registros gravados após o deploy de 2026-08-13.
export async function getGiftsByCliente(filters: DashboardFilters, limit = 30) {
  const rows = await prisma.gift.groupBy({
    by: ["clienteNome"],
    where: { ...giftWhere(filters), clienteNome: { not: null } },
    _sum: { quantidade: true, valorTotalLiquido: true },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({
      cliente: r.clienteNome as string,
      brindes: r._count._all,
      unidades: r._sum.quantidade ?? 0,
      valor: r._sum.valorTotalLiquido ?? 0,
    }))
    .sort((a, b) => b.unidades - a.unidades)
    .slice(0, limit);
}

// Retorna brindes por dia × filial — usado no gráfico de tendência da aba Brindes.
// Formato: [{ day: "2026-08-01", [storeName]: units, ... }, ...]
export async function getGiftsByDayByStore(filters: DashboardFilters) {
  const rows = await prisma.gift.findMany({
    where: giftWhere(filters),
    select: { giftDate: true, quantidade: true, storeId: true, store: { select: { name: true, displayGroup: true } } },
  });

  // Agrupa por dia + store (usa displayGroup se existir, senão name)
  const map = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const day = r.giftDate.toISOString().slice(0, 10);
    const storeName = r.store.displayGroup ?? r.store.name;
    if (!map.has(day)) map.set(day, new Map());
    const dayMap = map.get(day)!;
    dayMap.set(storeName, (dayMap.get(storeName) ?? 0) + r.quantidade);
  }

  // Conjunto de todas as lojas
  const storeNames = [...new Set(rows.map((r) => r.store.displayGroup ?? r.store.name))].sort();

  // Converte para array de objetos { day, [storeName]: units }
  const result = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, dayMap]) => {
      const obj: Record<string, string | number> = { day };
      for (const s of storeNames) obj[s] = dayMap.get(s) ?? 0;
      return obj;
    });

  return { data: result, stores: storeNames };
}

// Produto (não grupo) com maior "Estoque parado - Vendas recentes" — o que sobrou muito e
// vendeu pouco é o que precisa de empurrão (desconto, destaque na loja, etc). Vendas usa uma
// janela de dias (não all-time, ao contrário do sell-through) pra não misturar produto de
// coleção antiga "parado" com produto normal que só vendeu bem há muito tempo.
// Exclui a coleção "BESTSELLER" (linha permanente/best-seller marcada assim no DAPIC) — esses
// produtos naturalmente têm bastante estoque e podem ter uma janela de 30d fraca por acaso, mas
// não são o que precisa de incentivo (Rodrigo confirmou em 2026-08-10, ex: Ultra Light Black).
export async function getTopParaIncentivar(dias = 30, limit = 10, storeIds?: string[]) {
  const desde = new Date();
  desde.setDate(desde.getDate() - dias);

  const [stock, vendas] = await Promise.all([
    prisma.stockSnapshot.groupBy({
      by: ["produto"],
      where: { ...stockWhere({ storeIds }), colecao: { not: "BESTSELLER" } },
      _sum: { quantidadeDisponivel: true },
    }),
    prisma.sale.groupBy({
      by: ["produto"],
      where: { saleDate: { gte: desde }, ...(storeIds !== undefined ? { storeId: { in: storeIds } } : {}) },
      _sum: { quantidade: true },
    }),
  ]);

  const vendidoByProduto = new Map(vendas.map((v) => [v.produto, v._sum.quantidade ?? 0]));

  return stock
    .map((s) => {
      const estoque = s._sum.quantidadeDisponivel ?? 0;
      const vendido = vendidoByProduto.get(s.produto) ?? 0;
      return { produto: s.produto, estoque, vendido, diferenca: estoque - vendido };
    })
    .filter((r) => r.estoque > 0)
    .sort((a, b) => b.diferenca - a.diferenca)
    .slice(0, limit);
}

// Separada de getAtacadoCidades de propósito — bug achado pelo Rodrigo em 2026-09-08: o "Mapa de
// vendas — Site" (aba Vendas) reaproveitava getAtacadoCidades passando tabelasPreco=["Tabela
// varejo"], mas essa função sempre aplica canalWhere("b2b") por baixo dos panos (fix de
// 2026-09-02, específico da aba Atacado-Cidades) — cruzar "é atacado" com "é varejo" ao mesmo
// tempo sobrava quase nada (só RJ no teste real, deveria ter ~16 estados). Essa versão não tem
// noção de canal nenhuma, só filtra por loja/tabela de preço/marca normal (saleWhere).
export async function getSiteVarejoCidades(filters: DashboardFilters) {
  const cdStore = await prisma.store.findFirst({ where: { code: "CD" } });
  if (!cdStore) return { rows: [], totalCidades: 0, totalEstados: 0 };
  if (filters.storeIds !== undefined && !filters.storeIds.includes(cdStore.id)) {
    return { rows: [], totalCidades: 0, totalEstados: 0 };
  }

  const where: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    storeId: cdStore.id,
    cidade: { not: null },
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

// Receita histórica do site antigo (vnda, 2021-2025) — sempre total, sem filtro de período (a
// ideia é mostrar o "tamanho" do histórico pré-DAPIC de uma vez, não recortar por data). Pedido
// do Rodrigo em 2026-08-31 pro card na Visão Geral de Clientes.
export async function getReceitaHistoricaExterna(): Promise<{ receita: number; pedidos: number }> {
  const result = await prisma.vendaHistoricaExterna.aggregate({
    _sum: { valorTotal: true },
    _count: true,
  });
  return { receita: result._sum.valorTotal ?? 0, pedidos: result._count };
}

export type DistribuicaoPedidosItem = { pedidos: string; clientes: number; pct: number };

// Quantos clientes fizeram exatamente N pedidos (todo o histórico, DAPIC + site antigo somados —
// mesmo critério de getClienteSegmentacao: só entra quem já existe via DAPIC, o vnda só soma em
// cima). Pedido do Rodrigo em 2026-08-31. Bucket final "11+" pra não esticar a tabela pela cauda
// longa (tem cliente com 1778 pedidos — revenda/atacadista).
const DISTRIBUICAO_PEDIDOS_CAP = 10;
// vendedor opcional (2026-09-16) — mesmo motivo de getClientesCrmOverview. O histórico do site
// antigo (abaixo) continua sem esse filtro, mesma exceção já existente pra loja/marca/tabela/grupo.
export async function getDistribuicaoPedidos(
  filters: DashboardFilters,
  canal: Canal = "todos",
  vendedor?: string | null
): Promise<DistribuicaoPedidosItem[]> {
  const allTime: DashboardFilters = { ...filters, from: new Date(0), to: new Date() };
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(allTime),
    clienteNome: { not: null },
    ...(vendedor ? { vendedor } : {}),
    ...(canal !== "todos" ? { AND: [await canalWhere(canal)] } : {}),
  };
  const rows = await prisma.sale.findMany({ where, select: { clienteNome: true, storeId: true, dapicVendaId: true } });

  const pedidosPorCliente = new Map<string, Set<string>>();
  for (const r of rows) {
    const norm = (r.clienteNome as string).trim().toUpperCase();
    const set = pedidosPorCliente.get(norm) ?? new Set<string>();
    set.add(`${r.storeId}::${r.dapicVendaId}`);
    pedidosPorCliente.set(norm, set);
  }

  // Site antigo era só varejo online — não existe pedido "B2B" lá, mesmo raciocínio de
  // "devolução sempre B2C" já usado em outro lugar da CRM.
  if (canal !== "b2b") {
    const historico = await prisma.vendaHistoricaExterna.findMany({ select: { clienteNome: true, pedidoExterno: true } });
    for (const h of historico) {
      const norm = h.clienteNome.trim().toUpperCase();
      const set = pedidosPorCliente.get(norm);
      if (!set) continue;
      set.add(`vnda::${h.pedidoExterno}`);
    }
  }

  const buckets = new Map<string, number>();
  for (const set of pedidosPorCliente.values()) {
    const key = set.size > DISTRIBUICAO_PEDIDOS_CAP ? `${DISTRIBUICAO_PEDIDOS_CAP + 1}+` : String(set.size);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const totalClientes = pedidosPorCliente.size;

  const ordem = [...Array(DISTRIBUICAO_PEDIDOS_CAP)].map((_, i) => String(i + 1)).concat([`${DISTRIBUICAO_PEDIDOS_CAP + 1}+`]);
  return ordem
    .filter((k) => buckets.has(k))
    .map((k) => ({
      pedidos: k,
      clientes: buckets.get(k) ?? 0,
      pct: totalClientes > 0 ? ((buckets.get(k) ?? 0) / totalClientes) * 100 : 0,
    }));
}

// Os produtos mais vendidos em cada loja desde um horário de corte (o momento da sync
// anterior, tipicamente) — pro aviso do bot mostrar "o que vendeu desde a última atualização".
export async function getTopVendidosPorLoja(desde: Date, ate: Date, limit = 3) {
  const vendas = await prisma.sale.groupBy({
    by: ["storeId", "produto"],
    where: { saleDate: { gte: desde, lte: ate } },
    _sum: { quantidade: true },
  });
  if (!vendas.length) return [];

  const storeIds = [...new Set(vendas.map((v) => v.storeId))];
  const stores = await prisma.store.findMany({ where: { id: { in: storeIds } } });
  const storeName = new Map(stores.map((s) => [s.id, s.name]));

  const byStore = new Map<string, { produto: string; quantidade: number }[]>();
  for (const v of vendas) {
    const list = byStore.get(v.storeId) ?? [];
    list.push({ produto: v.produto, quantidade: v._sum.quantidade ?? 0 });
    byStore.set(v.storeId, list);
  }

  return [...byStore.entries()]
    .map(([storeId, produtos]) => ({
      storeName: storeName.get(storeId) ?? storeId,
      produtos: produtos.sort((a, b) => b.quantidade - a.quantidade).slice(0, limit),
    }))
    .sort((a, b) => a.storeName.localeCompare(b.storeName));
}

// Aba "Resumo do Dia" (pensada pro vendedor de loja física) — vendas de hoje (dia calendário
// Brasília) comparadas com a média diária dos `diasComparacao` dias anteriores, pra saber se o
// dia tá bom ou fraco sem precisar decorar histórico.
export async function getVendasHojeComComparacao(
  filters: Pick<DashboardFilters, "storeIds" | "marcas" | "tabelasPreco" | "grupoIn">,
  diasComparacao = 14
) {
  const hojeStr = todayBrasiliaStr(new Date());
  const inicioHoje = brasiliaDayStart(hojeStr);
  const fimHoje = brasiliaDayEnd(hojeStr);
  const inicioComparacao = new Date(inicioHoje);
  inicioComparacao.setDate(inicioComparacao.getDate() - diasComparacao);
  const fimComparacao = new Date(inicioHoje.getTime() - 1);

  const [hojeAgg, comparacaoAgg] = await Promise.all([
    prisma.sale.aggregate({
      where: saleWhere({ ...filters, from: inicioHoje, to: fimHoje }),
      _sum: { quantidade: true, valorTotalLiquido: true },
    }),
    prisma.sale.aggregate({
      where: saleWhere({ ...filters, from: inicioComparacao, to: fimComparacao }),
      _sum: { quantidade: true, valorTotalLiquido: true },
    }),
  ]);

  const hojeUnidades = hojeAgg._sum.quantidade ?? 0;
  const hojeReceita = hojeAgg._sum.valorTotalLiquido ?? 0;
  const mediaDiariaUnidades = (comparacaoAgg._sum.quantidade ?? 0) / diasComparacao;
  const mediaDiariaReceita = (comparacaoAgg._sum.valorTotalLiquido ?? 0) / diasComparacao;

  return {
    hojeUnidades,
    hojeReceita,
    mediaDiariaUnidades,
    mediaDiariaReceita,
    variacaoUnidadesPct: mediaDiariaUnidades > 0 ? (hojeUnidades / mediaDiariaUnidades - 1) * 100 : null,
    variacaoReceitaPct: mediaDiariaReceita > 0 ? (hojeReceita / mediaDiariaReceita - 1) * 100 : null,
    diasComparacao,
  };
}

// Ranking de produtos mais vendidos nos últimos 7 dias (dia calendário Brasília, inclusive
// hoje) — janela de 1 dia só costuma ficar vazia/rala numa loja física pequena.
export async function getMaisVendidosSemana(
  filters: Pick<DashboardFilters, "storeIds" | "marcas" | "tabelasPreco" | "grupoIn">,
  limit = 10
) {
  const hojeStr = todayBrasiliaStr(new Date());
  const fim = brasiliaDayEnd(hojeStr);
  const inicio = new Date(brasiliaDayStart(hojeStr));
  inicio.setDate(inicio.getDate() - 6);

  const vendas = await prisma.sale.groupBy({
    by: ["produto"],
    where: saleWhere({ ...filters, from: inicio, to: fim }),
    _sum: { quantidade: true, valorTotalLiquido: true },
  });

  return vendas
    .map((v) => ({
      produto: v.produto,
      unidades: v._sum.quantidade ?? 0,
      receita: v._sum.valorTotalLiquido ?? 0,
    }))
    .sort((a, b) => b.unidades - a.unidades)
    .slice(0, limit);
}

// Aba "Análise" (dentro de Vendas), pedido do Rodrigo em 2026-09-14: ele tinha duas planilhas
// manuais (análise de ticket e análise por tamanho) e queria "algo parecido" dentro do
// dashboard — refeito aqui como cálculo ao vivo em cima do Sale, em vez de importar as
// planilhas (que eram só um retrato manual e ficavam desatualizadas).

const TICKET_FAIXAS = ["até 300", "300-400", "400-500", "500-600", "600-700", "Acima de 700"] as const;

function faixaTicket(valor: number): (typeof TICKET_FAIXAS)[number] {
  if (valor <= 300) return TICKET_FAIXAS[0];
  if (valor <= 400) return TICKET_FAIXAS[1];
  if (valor <= 500) return TICKET_FAIXAS[2];
  if (valor <= 600) return TICKET_FAIXAS[3];
  if (valor <= 700) return TICKET_FAIXAS[4];
  return TICKET_FAIXAS[5];
}

// Ticket = valor líquido do pedido: soma das linhas de venda que passam no filtro, MENOS
// qualquer devolução gravada no mesmo dapicVendaId (troca dentro do mesmo fechamento de PDV —
// achado real em 2026-09-14 checando o banco: ~13% dos pedidos têm venda E devolução juntas no
// mesmo dapicVendaId; sem descontar, o ticket ficava inflado pelo valor do item trocado, que o
// cliente não pagou de fato). Devolução "solta" (pedido só com devolução, sem venda) não entra
// aqui — nunca existiu nesse CTE, que só parte da tabela Sale. Quebrado por loja, faixa de valor
// e mês — pensado pra virar 1 tabela/gráfico por loja, igual a planilha manual que o Rodrigo já tinha.
export async function getTicketPorFaixaMensal(
  filters: Pick<DashboardFilters, "storeIds" | "marcas" | "tabelasPreco" | "colecaoIn" | "grupoIn">
) {
  const pedidos = await prisma.$queryRaw<{ storeId: string; orderday: Date; valor: number }[]>`
    WITH vendas AS (
      SELECT
        "storeId",
        "dapicVendaId",
        MIN("saleDate") AS "saleDate",
        SUM("valorTotalLiquido") AS "valorVenda"
      FROM "Sale"
      WHERE "dapicVendaId" IS NOT NULL
        ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
        ${filters.marcas !== undefined ? Prisma.sql`AND "marca" = ANY(${filters.marcas})` : Prisma.empty}
        ${filters.tabelasPreco !== undefined ? Prisma.sql`AND ("tabelaPreco" = ANY(${filters.tabelasPreco}) OR "tabelaPreco" IS NULL)` : Prisma.empty}
        ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
        ${filters.colecaoIn ? Prisma.sql`AND "colecao" = ANY(${filters.colecaoIn})` : Prisma.empty}
      GROUP BY "storeId", "dapicVendaId"
    ),
    devolucoes AS (
      SELECT "storeId", "dapicVendaId", SUM("valorTotal") AS "valorDevolvido"
      FROM "Return"
      WHERE "dapicVendaId" IS NOT NULL
      GROUP BY "storeId", "dapicVendaId"
    )
    SELECT
      v."storeId",
      ((v."saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date AS orderday,
      (v."valorVenda" - COALESCE(d."valorDevolvido", 0))::float AS valor
    FROM vendas v
    LEFT JOIN devolucoes d ON d."storeId" = v."storeId" AND d."dapicVendaId" = v."dapicVendaId"
  `;

  const stores = await prisma.store.findMany();
  const storeName = new Map(stores.map((s) => [s.id, s.displayGroup ?? s.name]));

  const monthsSet = new Set<string>();
  // loja -> faixa -> mês -> contagem de pedidos
  const grid = new Map<string, Map<string, Map<string, number>>>();
  for (const p of pedidos) {
    // Mesmo motivo do comentário em getSalesByDay: o SQL já resolveu o dia certo em horário de
    // Brasília e devolveu como DATE — reformatar aqui com timeZone jogaria pro mês errado.
    const month = new Date(p.orderday).toISOString().slice(0, 7);
    monthsSet.add(month);
    const store = storeName.get(p.storeId) ?? p.storeId;
    const faixa = faixaTicket(p.valor);
    if (!grid.has(store)) grid.set(store, new Map());
    const byFaixa = grid.get(store)!;
    if (!byFaixa.has(faixa)) byFaixa.set(faixa, new Map());
    const byMonth = byFaixa.get(faixa)!;
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
  }

  const months = [...monthsSet].sort();
  const rows = [...grid.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([storeName, byFaixa]) => ({
      storeName,
      faixas: TICKET_FAIXAS.map((label) => ({
        label,
        counts: months.map((m) => byFaixa.get(label)?.get(m) ?? 0),
      })),
    }));

  return { months, rows };
}

// Mix de tamanho por mês, dentro de 1 grupo só (% do vendido LÍQUIDO daquele grupo naquele mês
// que veio de cada tamanho — desconta devolução, mesmo critério "líquido" usado no resto do
// dashboard, ver netByReturns) — mesma ideia das abas por família (Ultra Light/Classic/Camisa)
// da planilha manual, só que qualquer grupo pode ser escolhido em vez de 3 fixos.
export async function getTamanhoMixMensal(
  filters: Pick<DashboardFilters, "storeIds" | "marcas" | "tabelasPreco" | "colecaoIn">,
  grupo: string
) {
  const rows = await prisma.$queryRaw<{ tamanho: string; month: Date; qty: number }[]>`
    SELECT "tamanho", month, SUM(qty)::float AS qty FROM (
      SELECT
        "tamanho",
        date_trunc('month', (("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')) AS month,
        "quantidade" AS qty
      FROM "Sale"
      WHERE "grupo" = ${grupo}
        AND "tamanho" IS NOT NULL
        ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
        ${filters.marcas !== undefined ? Prisma.sql`AND "marca" = ANY(${filters.marcas})` : Prisma.empty}
        ${filters.tabelasPreco !== undefined ? Prisma.sql`AND ("tabelaPreco" = ANY(${filters.tabelasPreco}) OR "tabelaPreco" IS NULL)` : Prisma.empty}
        ${filters.colecaoIn ? Prisma.sql`AND "colecao" = ANY(${filters.colecaoIn})` : Prisma.empty}
      UNION ALL
      SELECT
        "tamanho",
        date_trunc('month', (("returnDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')) AS month,
        -"quantidade" AS qty
      FROM "Return"
      WHERE "grupo" = ${grupo}
        AND "tamanho" IS NOT NULL
        ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
        ${filters.colecaoIn ? Prisma.sql`AND ("colecao" = ANY(${filters.colecaoIn}) OR "colecao" IS NULL)` : Prisma.empty}
    ) combined
    GROUP BY "tamanho", month
  `;

  const monthsSet = new Set<string>();
  const totalByMonth = new Map<string, number>();
  const byTamanho = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const month = new Date(r.month).toISOString().slice(0, 7);
    monthsSet.add(month);
    totalByMonth.set(month, (totalByMonth.get(month) ?? 0) + r.qty);
    if (!byTamanho.has(r.tamanho)) byTamanho.set(r.tamanho, new Map());
    byTamanho.get(r.tamanho)!.set(month, r.qty);
  }

  const months = [...monthsSet].sort();
  const tamanhos = sortTamanhos([...byTamanho.keys()]);
  const rowsOut = tamanhos.map((t) => ({
    tamanho: t,
    pct: months.map((m) => {
      const total = totalByMonth.get(m) ?? 0;
      const qty = byTamanho.get(t)?.get(m) ?? 0;
      return total > 0 ? (qty / total) * 100 : 0;
    }),
  }));

  return { months, rows: rowsOut };
}

