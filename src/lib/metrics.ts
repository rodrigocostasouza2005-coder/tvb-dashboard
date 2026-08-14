import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export type Dimension = "grupo" | "produto" | "tamanho";

export type DashboardFilters = {
  storeIds?: string[];
  marcas?: string[];
  tabelasPreco?: string[];
  from: Date;
  to: Date;
  // Restringe a grupos específicos — usado pra aplicar a regra de permissão do VENDEDOR
  // (só vê grupos prioritários) em qualquer dimensão, não só quando agrupando por grupo.
  grupoIn?: string[];
};

function saleWhere(filters: DashboardFilters): Prisma.SaleWhereInput {
  return {
    saleDate: { gte: filters.from, lte: filters.to },
    ...(filters.storeIds !== undefined ? { storeId: { in: filters.storeIds } } : {}),
    ...(filters.marcas !== undefined ? { marca: { in: filters.marcas } } : {}),
    ...(filters.tabelasPreco !== undefined ? { tabelaPreco: { in: filters.tabelasPreco } } : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
  };
}

function stockWhere(filters: Pick<DashboardFilters, "storeIds" | "grupoIn">): Prisma.StockSnapshotWhereInput {
  return {
    // "(sem grupo)" é o que o sync grava quando o DAPIC não manda Grupo pra aquela linha —
    // na prática é sempre matéria-prima/insumo (etiqueta, zíper, tecido em rolo), nunca produto
    // de verdade à venda. Rodrigo pediu pra tirar do dashboard inteiro.
    grupo: { not: "(sem grupo)" },
    ...(filters.storeIds !== undefined ? { storeId: { in: filters.storeIds } } : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
  };
}

export async function getKpiSummary(filters: DashboardFilters) {
  const [salesAgg, stockAgg] = await Promise.all([
    prisma.sale.aggregate({
      where: saleWhere(filters),
      _sum: { quantidade: true, valorTotalLiquido: true },
    }),
    prisma.stockSnapshot.aggregate({
      where: stockWhere(filters),
      _sum: { quantidadeDisponivel: true },
    }),
  ]);

  return {
    unitsSold: salesAgg._sum.quantidade ?? 0,
    revenue: salesAgg._sum.valorTotalLiquido ?? 0,
    currentStock: stockAgg._sum.quantidadeDisponivel ?? 0,
  };
}

// Vendas agrupadas por dia (horário de Brasília) dentro do período filtrado — usado pro
// gráfico de tendência da Visão Geral. Agrupar por dia em SQL é mais simples que em JS aqui
// porque saleDate é timestamp; usa AT TIME ZONE pra não cair no dia errado perto da meia-noite
// (mesmo cuidado de fuso já documentado em filters.ts).
export async function getSalesByDay(filters: DashboardFilters) {
  const rows = await prisma.$queryRaw<{ day: Date; units: bigint; revenue: number }[]>`
    SELECT
      (("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      SUM("quantidade") AS units,
      SUM("valorTotalLiquido") AS revenue
    FROM "Sale"
    WHERE "saleDate" >= ${filters.from}
      AND "saleDate" <= ${filters.to}
      ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
      ${filters.marcas !== undefined ? Prisma.sql`AND "marca" = ANY(${filters.marcas})` : Prisma.empty}
      ${filters.tabelasPreco !== undefined ? Prisma.sql`AND "tabelaPreco" = ANY(${filters.tabelasPreco})` : Prisma.empty}
      ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
    GROUP BY day
    ORDER BY day ASC
  `;
  // O SQL acima já resolveu o dia certo em horário de Brasília e devolveu como DATE — o driver
  // do Postgres traz DATE como Date em meia-noite UTC. Reformatar essa data usando timeZone
  // America/Sao_Paulo aqui jogaria pro dia anterior (meia-noite UTC = 21h do dia anterior em
  // Brasília), o mesmo tipo de bug de fuso já visto nesse projeto — por isso lê direto em UTC.
  return rows.map((r) => ({
    day: new Date(r.day).toISOString().slice(0, 10),
    unitsSold: Number(r.units),
    revenue: Number(r.revenue),
  }));
}

// Mesma ideia de getSalesByDay, mas quebrado por loja — pro gráfico de comparação de lojas
// da Visão Geral. Agrupa por displayGroup (ex: ATACADO + Site viram uma série só "TVB Site e
// Atacado"), igual o filtro de loja já faz, senão a mesma operação apareceria duplicada.
export async function getSalesByDayPerStore(filters: DashboardFilters) {
  const rows = await prisma.$queryRaw<{ day: Date; storeId: string; units: bigint }[]>`
    SELECT
      (("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date AS day,
      "storeId",
      SUM("quantidade") AS units
    FROM "Sale"
    WHERE "saleDate" >= ${filters.from}
      AND "saleDate" <= ${filters.to}
      ${filters.storeIds !== undefined ? Prisma.sql`AND "storeId" = ANY(${filters.storeIds})` : Prisma.empty}
      ${filters.marcas !== undefined ? Prisma.sql`AND "marca" = ANY(${filters.marcas})` : Prisma.empty}
      ${filters.tabelasPreco !== undefined ? Prisma.sql`AND "tabelaPreco" = ANY(${filters.tabelasPreco})` : Prisma.empty}
      ${filters.grupoIn ? Prisma.sql`AND "grupo" = ANY(${filters.grupoIn})` : Prisma.empty}
    GROUP BY day, "storeId"
    ORDER BY day ASC
  `;

  const stores = await prisma.store.findMany({ where: { sellsProducts: true } });
  const seriesNameByStoreId = new Map(stores.map((s) => [s.id, s.displayGroup ?? s.name]));

  const byDay = new Map<string, Record<string, number>>();
  const seriesNames = new Set<string>();
  for (const r of rows) {
    const seriesName = seriesNameByStoreId.get(r.storeId);
    if (!seriesName) continue; // loja que não vende (armazém/CD) não deveria ter Sale, ignora por segurança
    const day = new Date(r.day).toISOString().slice(0, 10);
    seriesNames.add(seriesName);
    const dayRow = byDay.get(day) ?? {};
    dayRow[seriesName] = (dayRow[seriesName] ?? 0) + Number(r.units);
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
  }
}

function dimensionKey(dimension: Dimension, row: { grupo?: string; produto?: string; tamanho?: string | null }) {
  const v = dimension === "grupo" ? row.grupo : dimension === "produto" ? row.produto : row.tamanho;
  return v && v.trim() ? v : "—";
}

export async function getSalesByDimension(filters: DashboardFilters, dimension: Dimension = "grupo") {
  const rows = await groupSalesByDimension(dimension, saleWhere(filters));
  return rows
    .map((r) => ({
      key: dimensionKey(dimension, r),
      unitsSold: r._sum.quantidade ?? 0,
      revenue: r._sum.valorTotalLiquido ?? 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
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

function returnWhere(filters: DashboardFilters): Prisma.ReturnWhereInput {
  return {
    returnDate: { gte: filters.from, lte: filters.to },
    ...(filters.storeIds !== undefined ? { storeId: { in: filters.storeIds } } : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
  };
}

async function groupReturnsByDimension(dimension: Dimension, where: Prisma.ReturnWhereInput) {
  switch (dimension) {
    case "grupo":
      return prisma.return.groupBy({ by: ["grupo"], where, _sum: { quantidade: true, valorTotal: true } });
    case "produto":
      return prisma.return.groupBy({ by: ["produto"], where, _sum: { quantidade: true, valorTotal: true } });
    case "tamanho":
      return prisma.return.groupBy({ by: ["tamanho"], where, _sum: { quantidade: true, valorTotal: true } });
  }
}

export async function getReturnsByDimension(filters: DashboardFilters, dimension: Dimension = "grupo") {
  const rows = await groupReturnsByDimension(dimension, returnWhere(filters));
  return rows
    .map((r) => ({
      key: dimensionKey(dimension, r),
      unitsReturned: r._sum.quantidade ?? 0,
      value: r._sum.valorTotal ?? 0,
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

// Pega o snapshot mais recente por loja+produto (evita somar duplicado se já tivermos
// vários syncs no histórico).
// StockSnapshot tem 1 linha por storeId+cod (upsert no sync mantém sempre atualizada, ver
// upsertStockSnapshots) — não tem mais duplicata histórica pra dedupar aqui.
async function latestStockSnapshots(filters: Pick<DashboardFilters, "storeIds" | "grupoIn">) {
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
  const by = dimension === "grupo" ? "grupo" : dimension === "produto" ? "produto" : "tamanho";
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
function resolveSellThrough(unitsSoldAllTime: number, currentStock: number, produzido: number) {
  if (produzido > 0 && produzido >= unitsSoldAllTime) {
    return (unitsSoldAllTime / produzido) * 100;
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

function sortTamanhos(tamanhos: string[]) {
  return tamanhos.sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

// Pesquisa sempre por produto, com o estoque aberto por tamanho na mesma linha (pedido do
// Rodrigo em 2026-08-12 — antes a aba tinha um seletor Grupo/Produto/Tamanho, mas ele queria ver
// o produto com os tamanhos lado a lado, não trocar de visão). "Total" da quebra por tamanho é a
// mesma soma que currentStock já mostrava — não é outro número, só decomposto.
export async function searchStockVsSalesComTamanhos(filters: DashboardFilters, query: string) {
  const rows = await searchStockVsSales(filters, "produto", query);
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

export async function getReplenishment(filters: Pick<DashboardFilters, "storeIds" | "grupoIn">) {
  const [stock, minimumRules] = await Promise.all([
    latestStockSnapshots(filters),
    prisma.stockMinimumRule.findMany(),
  ]);
  const storeIds = [...new Set(stock.map((s) => s.storeId))];
  const stores = await prisma.store.findMany({ where: { id: { in: storeIds } } });
  const storeName = new Map(stores.map((s) => [s.id, s.name]));

  // A reposição sempre vem do centro de distribuição ("CD" / TVB Site e Atacado).
  const cdStore = await prisma.store.findFirst({ where: { code: "CD" } });
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
        // Sem estoque na origem pra puxar = não tem reposição real pra fazer agora, só
        // polui a lista.
        (cdStockByCod.get(s.cod) ?? 0) > 0
    )
    .map((s) => ({
      storeId: s.storeId,
      storeName: storeName.get(s.storeId) ?? s.storeId,
      produto: s.produto,
      grupo: s.grupo,
      tamanho: s.tamanho,
      quantidadeDisponivel: s.quantidadeDisponivel,
      estoqueMinimo: s.estoqueMinimo as number,
      falta: (s.estoqueMinimo as number) - s.quantidadeDisponivel,
      origemSugerida: cdStore?.name ?? "—",
      estoqueNaOrigem: cdStockByCod.get(s.cod) ?? 0,
    }))
    // Por loja primeiro, maior falta primeiro dentro de cada loja.
    .sort((a, b) => a.storeName.localeCompare(b.storeName) || b.falta - a.falta);
}

// "Cliente novo" = a 1ª compra dele de todas (sem limite de data, dentro do resto do filtro
// aplicado — loja/marca/tabela de preço/grupo) caiu dentro do período escolhido no filtro de
// data. Pedido do Rodrigo em 2026-08-11 pro card da Visão Geral.
export async function getNewClientsCount(filters: DashboardFilters) {
  const where: Prisma.SaleWhereInput = {
    clienteNome: { not: null },
    ...(filters.storeIds !== undefined ? { storeId: { in: filters.storeIds } } : {}),
    ...(filters.marcas !== undefined ? { marca: { in: filters.marcas } } : {}),
    ...(filters.tabelasPreco !== undefined ? { tabelaPreco: { in: filters.tabelasPreco } } : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
  };
  const firstPurchaseByClient = await prisma.sale.groupBy({
    by: ["clienteNome"],
    where,
    _min: { saleDate: true },
  });
  return firstPurchaseByClient.filter(
    (c) => c._min.saleDate && c._min.saleDate >= filters.from && c._min.saleDate <= filters.to
  ).length;
}

export async function getVendedorRanking(filters: DashboardFilters) {
  const rows = await prisma.sale.groupBy({
    by: ["storeId", "vendedor"],
    where: { ...saleWhere(filters), vendedor: { not: null } },
    _sum: { quantidade: true, valorTotalLiquido: true },
    _count: { _all: true },
  });

  const storeIds = [...new Set(rows.map((r) => r.storeId))];
  const stores = await prisma.store.findMany({ where: { id: { in: storeIds } } });
  const storeName = new Map(stores.map((s) => [s.id, s.name]));

  return rows
    .map((r) => ({
      vendedor: r.vendedor as string,
      storeName: storeName.get(r.storeId) ?? r.storeId,
      pedidos: r._count._all,
      unidades: r._sum.quantidade ?? 0,
      receita: r._sum.valorTotalLiquido ?? 0,
    }))
    .sort((a, b) => b.receita - a.receita);
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

export async function getTopClientes(filters: DashboardFilters, limit = 30) {
  const rows = await prisma.sale.groupBy({
    by: ["clienteNome"],
    where: { ...saleWhere(filters), clienteNome: { not: null } },
    _sum: { quantidade: true, valorTotalLiquido: true },
    _count: { _all: true },
  });

  return rows
    .map((r) => ({
      cliente: r.clienteNome as string,
      pedidos: r._count._all,
      unidades: r._sum.quantidade ?? 0,
      receita: r._sum.valorTotalLiquido ?? 0,
    }))
    .sort((a, b) => b.receita - a.receita)
    .slice(0, limit);
}

export type StoreFilterOption = { id: string; name: string };

// Junta lojas com o mesmo displayGroup (ex: CD + ATACADO) numa única opção de filtro —
// o id vira "id1|id2", que parseFilters() expande de volta em vários storeId no where.
// Os dados por baixo continuam separados (evita somar/sobrescrever quantidade errado).
function groupStoresForFilter(stores: { id: string; name: string; displayGroup: string | null }[]): StoreFilterOption[] {
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

export async function getEstoqueAtual(filters: Pick<DashboardFilters, "storeIds" | "grupoIn">, dimension: Dimension) {
  const stock = await latestStockSnapshots(filters);

  const byKey = new Map<string, { quantidade: number; valorCusto: number }>();
  for (const s of stock) {
    const key = dimensionKey(dimension, s);
    const acc = byKey.get(key) ?? { quantidade: 0, valorCusto: 0 };
    acc.quantidade += s.quantidadeDisponivel;
    acc.valorCusto += (s.valorCusto ?? 0) * s.quantidadeDisponivel;
    byKey.set(key, acc);
  }

  return [...byKey.entries()]
    .map(([key, v]) => ({ key, quantidade: v.quantidade, valorCusto: v.valorCusto }))
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

// Lojas "cruas" (sem agrupar CD+ATACADO) — usado na tela de estoque mínimo, onde a regra
// precisa mirar o armazenador de verdade, não a opção agrupada do filtro.
export async function getRawStores() {
  return prisma.store.findMany({ orderBy: { name: "asc" } });
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

export async function getMinimumRules() {
  return prisma.stockMinimumRule.findMany({
    include: { store: true },
    orderBy: [{ storeId: "asc" }, { grupo: "asc" }, { tamanho: "asc" }],
  });
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

// Produto (não grupo) com maior "Estoque parado - Vendas recentes" — o que sobrou muito e
// vendeu pouco é o que precisa de empurrão (desconto, destaque na loja, etc). Vendas usa uma
// janela de dias (não all-time, ao contrário do sell-through) pra não misturar produto de
// coleção antiga "parado" com produto normal que só vendeu bem há muito tempo.
// Exclui a coleção "BESTSELLER" (linha permanente/best-seller marcada assim no DAPIC) — esses
// produtos naturalmente têm bastante estoque e podem ter uma janela de 30d fraca por acaso, mas
// não são o que precisa de incentivo (Rodrigo confirmou em 2026-08-10, ex: Ultra Light Black).
export async function getTopParaIncentivar(dias = 30, limit = 10) {
  const desde = new Date();
  desde.setDate(desde.getDate() - dias);

  const [stock, vendas] = await Promise.all([
    prisma.stockSnapshot.groupBy({
      by: ["produto"],
      where: { ...stockWhere({}), colecao: { not: "BESTSELLER" } },
      _sum: { quantidadeDisponivel: true },
    }),
    prisma.sale.groupBy({
      by: ["produto"],
      where: { saleDate: { gte: desde } },
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
