import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

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
};

function returnWhere(filters: DashboardFilters): Prisma.ReturnWhereInput {
  // marca e tabelaPreco ainda não estão populados nos registros históricos de devolução
  // (backfill pendente) — filtrar por esses campos zeraria todas as devoluções. Por ora
  // só filtramos por loja, período e grupo (que já existiam antes).
  return {
    returnDate: { gte: filters.from, lte: filters.to },
    ...(filters.storeIds !== undefined ? { storeId: { in: filters.storeIds } } : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
  };
}

function saleWhere(filters: DashboardFilters): Prisma.SaleWhereInput {
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

export type Canal = "todos" | "b2b" | "b2c";

// B2B = Tabela atacado (só isso, sem fallback de null). B2C = tudo mais (varejo, Black
// Friday, Promoção, e vendas sem tabela inferida) — decisão do Rodrigo em 2026-08-21: não
// existe um campo "canal" de verdade, tabela de preço é o proxy mais próximo disponível.
function canalWhere(canal: Canal): Prisma.SaleWhereInput {
  if (canal === "b2b") return { tabelaPreco: "Tabela atacado" };
  if (canal === "b2c") return { OR: [{ tabelaPreco: { not: "Tabela atacado" } }, { tabelaPreco: null }] };
  return {};
}

// KPIs pra Lâmina Mensal: além de unidades/receita, conta pedidos distintos (pra ticket
// médio = receita líquida / nº de pedidos, não / peças) e separa por canal B2B/B2C.
// Devolução é sempre B2C (confirmado pelo Rodrigo em 2026-08-21, não precisa segmentar por
// tabelaPreco) — então em "todos" e "b2c" o valor devolvido do período inteiro é aplicado
// normalmente; em "b2b" não há devolução nenhuma (líquida = bruta).
export async function getMonthlySnapshotKpi(filters: DashboardFilters, canal: Canal = "todos") {
  const where: Prisma.SaleWhereInput = { AND: [saleWhere(filters), canalWhere(canal)] };
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
      ${filters.tabelasPreco !== undefined ? Prisma.sql`AND ("tabelaPreco" = ANY(${filters.tabelasPreco}) OR "tabelaPreco" IS NULL)` : Prisma.empty}
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
      ${filters.tabelasPreco !== undefined ? Prisma.sql`AND ("tabelaPreco" = ANY(${filters.tabelasPreco}) OR "tabelaPreco" IS NULL)` : Prisma.empty}
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
    case "colecao":
      return prisma.sale.groupBy({ by: ["colecao"], where, _sum: { quantidade: true, valorTotalLiquido: true } });
  }
}

function dimensionKey(dimension: Dimension, row: { grupo?: string; produto?: string; tamanho?: string | null; colecao?: string | null }) {
  const v = dimension === "grupo" ? row.grupo : dimension === "produto" ? row.produto : dimension === "tamanho" ? row.tamanho : row.colecao;
  return v && v.trim() ? v : "—";
}

export async function getSalesByDimension(filters: DashboardFilters, dimension: Dimension = "grupo", canal: Canal = "todos") {
  const where: Prisma.SaleWhereInput = canal === "todos" ? saleWhere(filters) : { AND: [saleWhere(filters), canalWhere(canal)] };
  const rows = await groupSalesByDimension(dimension, where);
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

// Pega o snapshot mais recente por loja+produto (evita somar duplicado se já tivermos
// vários syncs no histórico).
// Total de estoque atual sem filtro de data — usado para o card "Estoque atual" na aba
// Estoque × Vendas, onde a data filtra vendas mas não deve mudar o snapshot de estoque.
export async function getTotalStock(filters: Pick<DashboardFilters, "storeIds" | "grupoIn">) {
  const result = await prisma.stockSnapshot.aggregate({
    where: stockWhere(filters),
    _sum: { quantidadeDisponivel: true },
  });
  return result._sum.quantidadeDisponivel ?? 0;
}

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
function resolveSellThrough(unitsSoldAllTime: number, currentStock: number, produzido: number) {
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
    .map((s) => ({
      storeId: s.storeId,
      storeName: storeName.get(s.storeId) ?? s.storeId,
      produto: s.produto,
      grupo: s.grupo,
      colecao: s.colecao,
      tamanho: s.tamanho,
      quantidadeDisponivel: s.quantidadeDisponivel,
      estoqueMinimo: s.estoqueMinimo as number,
      falta: Math.min((s.estoqueMinimo as number) - s.quantidadeDisponivel, cdStockByCod.get(s.cod) ?? 0),
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

// Devoluções não têm clienteNome no schema, mas dapicVendaId é o mesmo id da venda original
// — junta de volta com Sale (storeId+dapicVendaId) pra descobrir de quem foi cada devolução.
// Devolução é sempre B2C (confirmado pelo Rodrigo em 2026-08-21), então não faz sentido
// chamar isso quando canal="b2b" (líquida = bruta nesse caso, sem devolução nenhuma).
async function getValorDevolvidoPorCliente(filters: Pick<DashboardFilters, "storeIds" | "grupoIn" | "from" | "to">) {
  const returns = await prisma.return.findMany({
    where: { ...returnWhere(filters), dapicVendaId: { not: null } },
    select: { storeId: true, dapicVendaId: true, valorTotal: true },
  });
  if (returns.length === 0) return new Map<string, number>();

  const dapicVendaIds = [...new Set(returns.map((r) => r.dapicVendaId as number))];
  const storeIds = [...new Set(returns.map((r) => r.storeId))];
  const sales = await prisma.sale.findMany({
    where: { storeId: { in: storeIds }, dapicVendaId: { in: dapicVendaIds }, clienteNome: { not: null } },
    select: { storeId: true, dapicVendaId: true, clienteNome: true },
  });
  const clienteByVenda = new Map(sales.map((s) => [`${s.storeId}::${s.dapicVendaId}`, s.clienteNome as string]));

  const devolvidoPorCliente = new Map<string, number>();
  for (const r of returns) {
    const cliente = clienteByVenda.get(`${r.storeId}::${r.dapicVendaId}`);
    if (!cliente) continue;
    devolvidoPorCliente.set(cliente, (devolvidoPorCliente.get(cliente) ?? 0) + r.valorTotal);
  }
  return devolvidoPorCliente;
}

// liquido=true desconta devolução da receita (usado só na Lâmina Mensal — pedido do Rodrigo
// em 2026-08-24). Padrão continua bruta pra não mudar o que a aba Clientes já mostra (lá está
// rotulado "Receita bruta").
export async function getTopClientes(
  filters: DashboardFilters,
  vendedor?: string | null,
  limit = 30,
  canal: Canal = "todos",
  liquido = false
) {
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    clienteNome: { not: null },
    ...(vendedor ? { vendedor } : {}),
    ...(canal !== "todos" ? { AND: [canalWhere(canal)] } : {}),
  };
  const [rows, devolvidoPorCliente, vendedorRows] = await Promise.all([
    prisma.sale.groupBy({
      by: ["clienteNome"],
      where,
      _sum: { quantidade: true, valorTotalLiquido: true },
      _count: { _all: true },
    }),
    liquido && canal !== "b2b" ? getValorDevolvidoPorCliente(filters) : Promise.resolve(new Map<string, number>()),
    // Vendedor "principal" de cada cliente — quem mais faturou em cima dele no período, já que
    // um cliente pode ter sido atendido por mais de um vendedor.
    prisma.sale.groupBy({ by: ["clienteNome", "vendedor"], where, _sum: { valorTotalLiquido: true } }),
  ]);

  const vendedorPrincipalPorCliente = new Map<string, string>();
  const melhorReceitaPorCliente = new Map<string, number>();
  for (const r of vendedorRows) {
    const cliente = r.clienteNome as string;
    if (!r.vendedor) continue;
    const rev = r._sum.valorTotalLiquido ?? 0;
    if (rev > (melhorReceitaPorCliente.get(cliente) ?? -1)) {
      melhorReceitaPorCliente.set(cliente, rev);
      vendedorPrincipalPorCliente.set(cliente, r.vendedor);
    }
  }

  const sorted = rows
    .map((r) => {
      const cliente = r.clienteNome as string;
      const receitaBruta = r._sum.valorTotalLiquido ?? 0;
      const devolvido = devolvidoPorCliente.get(cliente) ?? 0;
      return {
        cliente,
        vendedor: vendedorPrincipalPorCliente.get(cliente) ?? null,
        pedidos: r._count._all,
        unidades: r._sum.quantidade ?? 0,
        receitaBruta,
        receitaLiquida: liquido ? receitaBruta - devolvido : receitaBruta,
      };
    })
    .sort((a, b) => (liquido ? b.receitaLiquida - a.receitaLiquida : b.receitaBruta - a.receitaBruta))
    .slice(0, limit);

  // Enriquece com telefone/email da tabela Client (join por nome)
  const nomes = sorted.map((r) => r.cliente);
  const clientesCadastro = await prisma.clienteCadastro.findMany({ where: { nome: { in: nomes } } });
  const cadastroByNome = new Map(clientesCadastro.map((c) => [c.nome, c]));

  return sorted.map((r) => {
    const cad = cadastroByNome.get(r.cliente);
    return {
      ...r,
      telefone: cad?.telefone ?? cad?.celular ?? null,
      email: cad?.email ?? null,
      dataNascimento: cad?.dataNascimento ?? null,
    };
  });
}

// Aniversariantes de um mês específico (1-12), independente do ano de nascimento — pra
// campanha de aniversário. Segue os mesmos filtros da página (loja/marca/tabela de
// preço/vendedor/período) — só entra quem tem venda batendo com o filtro atual, mesma lista
// de clientes que já aparece em getTopClientes, só que sem o limite de 30 e sem ordenar por
// receita. Ordenado pelo dia do mês.
export async function getAniversariantesDoMes(filters: DashboardFilters, vendedor: string | null | undefined, month: number) {
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    clienteNome: { not: null },
    ...(vendedor ? { vendedor } : {}),
  };
  const clientesFiltrados = await prisma.sale.groupBy({ by: ["clienteNome"], where });
  const nomes = clientesFiltrados.map((r) => r.clienteNome).filter((n): n is string => n !== null);
  if (nomes.length === 0) return [];

  const clientes = await prisma.clienteCadastro.findMany({
    where: { nome: { in: nomes }, dataNascimento: { not: null } },
  });
  return clientes
    .filter((c): c is typeof c & { dataNascimento: Date } => c.dataNascimento !== null && c.dataNascimento.getUTCMonth() + 1 === month)
    .sort((a, b) => a.dataNascimento.getUTCDate() - b.dataNascimento.getUTCDate());
}

export async function getMonthlySalesByStore(filters: DashboardFilters, canal: Canal = "todos") {
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
      ${canal === "b2b" ? Prisma.sql`AND "tabelaPreco" = 'Tabela atacado'` : Prisma.empty}
      ${canal === "b2c" ? Prisma.sql`AND ("tabelaPreco" IS DISTINCT FROM 'Tabela atacado')` : Prisma.empty}
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

export async function getVendedores(): Promise<string[]> {
  const rows = await prisma.sale.findMany({
    distinct: ["vendedor"],
    select: { vendedor: true },
    where: { vendedor: { not: null } },
  });
  return rows.map((r) => r.vendedor as string).sort();
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

// Produtos dentro de cada grupo — usado pra expandir um grupo na aba Estoque Atual,
// igual ao padrão getSalesByGrupoProduto/getGiftsByGrupoProduto.
export async function getEstoqueAtualPorGrupoProduto(filters: Pick<DashboardFilters, "storeIds" | "grupoIn">) {
  const stock = await latestStockSnapshots(filters);
  // Chave composta separada — evita depender de split de string no nome do produto.
  const byKey = new Map<string, { grupo: string; produto: string; quantidade: number; valorCusto: number }>();
  for (const s of stock) {
    const mapKey = `${s.grupo}\x00${s.produto}`;
    const acc = byKey.get(mapKey) ?? { grupo: s.grupo, produto: s.produto, quantidade: 0, valorCusto: 0 };
    acc.quantidade += s.quantidadeDisponivel;
    acc.valorCusto += (s.valorCusto ?? 0) * s.quantidadeDisponivel;
    byKey.set(mapKey, acc);
  }
  return [...byKey.values()]
    .map((v) => ({ grupo: v.grupo, key: v.produto, quantidade: v.quantidade, valorCusto: v.valorCusto }))
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

export async function getAtacadoVendas(filters: DashboardFilters) {
  const cdStore = await prisma.store.findFirst({ where: { code: "CD" } });
  if (!cdStore) return { kpis: { receita: 0, pedidos: 0, unidades: 0, ticketMedio: 0 }, byDay: [], topProdutos: [] };

  const where: Prisma.SaleWhereInput = {
    storeId: cdStore.id,
    saleDate: { gte: filters.from, lte: filters.to },
    ...(filters.tabelasPreco !== undefined ? { tabelaPreco: { in: filters.tabelasPreco } } : {}),
  };

  const [agg, byDayRaw, topGrupos] = await Promise.all([
    prisma.sale.aggregate({ where, _sum: { quantidade: true, valorTotalLiquido: true }, _count: { dapicVendaId: true } }),
    prisma.$queryRaw<{ day: Date; units: bigint; revenue: number }[]>`
      SELECT
        (("saleDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date AS day,
        SUM("quantidade") AS units,
        SUM("valorTotalLiquido") AS revenue
      FROM "Sale"
      WHERE "storeId" = ${cdStore.id}
        AND "saleDate" >= ${filters.from}
        AND "saleDate" <= ${filters.to}
        ${filters.tabelasPreco !== undefined ? Prisma.sql`AND ("tabelaPreco" = ANY(${filters.tabelasPreco}) OR "tabelaPreco" IS NULL)` : Prisma.empty}
      GROUP BY day ORDER BY day ASC
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
    byDay: byDayRaw.map(r => ({ day: new Date(r.day).toISOString().slice(0, 10), units: Number(r.units), revenue: Number(r.revenue) })),
    topProdutos: topGrupos.map(r => ({ grupo: r.grupo, produto: r.produto, unidades: r._sum.quantidade ?? 0, receita: r._sum.valorTotalLiquido ?? 0 })),
  };
}

export async function getAtacadoCidades(filters: DashboardFilters) {
  const cdStore = await prisma.store.findFirst({ where: { code: "CD" } });
  if (!cdStore) return { rows: [], totalCidades: 0, totalEstados: 0 };

  const where: Prisma.SaleWhereInput = {
    storeId: cdStore.id,
    saleDate: { gte: filters.from, lte: filters.to },
    cidade: { not: null },
    ...(filters.tabelasPreco !== undefined ? { tabelaPreco: { in: filters.tabelasPreco } } : {}),
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
  const cdStore = await prisma.store.findFirst({ where: { code: "CD" } });
  if (!cdStore) return { rows: [], totalClientes: 0, novosNoPeriodo: 0 };

  // Essa aba é especificamente sobre clientes de ATACADO (B2B) — sem esse filtro, misturava
  // com clientes de varejo do site (mesma loja física "Site+Atacado", canal diferente).
  const where: Prisma.SaleWhereInput = {
    storeId: cdStore.id,
    tabelaPreco: "Tabela atacado",
    saleDate: { gte: filters.from, lte: filters.to },
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
      where: { storeId: cdStore.id, tabelaPreco: "Tabela atacado", saleDate: { lt: filters.from }, clienteNome: { not: null } },
      _count: { id: true },
    }),
  ]);

  const clientesAntigos = new Set(primeiraVendaGeral.map(r => r.clienteNome));

  const mapped = rows.map(r => ({
    clienteNome: r.clienteNome ?? "—",
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

export async function getClienteRetencaoPorMes(filters: DashboardFilters) {
  const cdStore = await prisma.store.findFirst({ where: { code: "CD" } });
  if (!cdStore) return { months: [], compraram1x: 0, compraramMaisde1x: 0 };

  // Mesmo filtro de getAtacadoClientes — só B2B (Tabela atacado), não mistura com o varejo do
  // site que passa pela mesma loja física.
  const [salesInPeriod, allTimeFirst] = await Promise.all([
    prisma.sale.findMany({
      where: {
        storeId: cdStore.id,
        tabelaPreco: "Tabela atacado",
        saleDate: { gte: filters.from, lte: filters.to },
        clienteNome: { not: null },
      },
      select: { clienteNome: true, saleDate: true, dapicVendaId: true },
    }),
    prisma.sale.groupBy({
      by: ["clienteNome"],
      where: { storeId: cdStore.id, tabelaPreco: "Tabela atacado", clienteNome: { not: null }, saleDate: { lte: filters.to } },
      _min: { saleDate: true },
    }),
  ]);

  const firstPurchaseMonth = new Map<string, string>();
  for (const r of allTimeFirst) {
    if (r.clienteNome && r._min.saleDate) {
      firstPurchaseMonth.set(r.clienteNome, r._min.saleDate.toISOString().slice(0, 7));
    }
  }

  // Cards: quantos clientes compraram exatamente 1x vs +1x no período
  const pedidosPorCliente = new Map<string, Set<number>>();
  for (const s of salesInPeriod) {
    if (!s.clienteNome) continue;
    const set = pedidosPorCliente.get(s.clienteNome) ?? new Set();
    set.add(s.dapicVendaId);
    pedidosPorCliente.set(s.clienteNome, set);
  }
  let compraram1x = 0;
  let compraramMaisde1x = 0;
  for (const [, pedidos] of pedidosPorCliente) {
    if (pedidos.size === 1) compraram1x++;
    else compraramMaisde1x++;
  }

  // Gráfico: clientes únicos por mês, separados em novos vs recorrentes
  const monthClientMap = new Map<string, Set<string>>();
  for (const s of salesInPeriod) {
    if (!s.clienteNome) continue;
    const monthKey = s.saleDate.toISOString().slice(0, 7);
    const set = monthClientMap.get(monthKey) ?? new Set();
    set.add(s.clienteNome);
    monthClientMap.set(monthKey, set);
  }

  const months = [...monthClientMap.entries()].sort().map(([month, clients]) => {
    let novos = 0;
    let recorrentes = 0;
    for (const cliente of clients) {
      const fp = firstPurchaseMonth.get(cliente);
      if (!fp || fp === month) novos++;
      else recorrentes++;
    }
    return { month, novos, recorrentes };
  });

  return { months, compraram1x, compraramMaisde1x };
}

// Versão varejo: mesma lógica mas usando saleWhere(filters) — respeita loja/marca/tabelaPreco
export async function getClienteRetencaoVarejo(filters: DashboardFilters) {
  const baseWhere = saleWhere(filters);

  const [salesInPeriod, allTimeFirst] = await Promise.all([
    prisma.sale.findMany({
      where: { ...baseWhere, clienteNome: { not: null } },
      select: { clienteNome: true, saleDate: true, dapicVendaId: true },
    }),
    prisma.sale.groupBy({
      by: ["clienteNome"],
      where: {
        clienteNome: { not: null },
        saleDate: { lte: filters.to },
        ...(filters.storeIds !== undefined ? { storeId: { in: filters.storeIds } } : {}),
        ...(filters.marcas !== undefined ? { marca: { in: filters.marcas } } : {}),
        ...(filters.tabelasPreco !== undefined ? { tabelaPreco: { in: filters.tabelasPreco } } : {}),
        ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
      },
      _min: { saleDate: true },
    }),
  ]);

  const firstPurchaseMonth = new Map<string, string>();
  for (const r of allTimeFirst) {
    if (r.clienteNome && r._min.saleDate) {
      firstPurchaseMonth.set(r.clienteNome, r._min.saleDate.toISOString().slice(0, 7));
    }
  }

  const pedidosPorCliente = new Map<string, Set<number>>();
  for (const s of salesInPeriod) {
    if (!s.clienteNome) continue;
    const set = pedidosPorCliente.get(s.clienteNome) ?? new Set();
    set.add(s.dapicVendaId);
    pedidosPorCliente.set(s.clienteNome, set);
  }
  let compraram1x = 0;
  let compraramMaisde1x = 0;
  for (const [, pedidos] of pedidosPorCliente) {
    if (pedidos.size === 1) compraram1x++;
    else compraramMaisde1x++;
  }

  const monthClientMap = new Map<string, Set<string>>();
  for (const s of salesInPeriod) {
    if (!s.clienteNome) continue;
    const monthKey = s.saleDate.toISOString().slice(0, 7);
    const set = monthClientMap.get(monthKey) ?? new Set();
    set.add(s.clienteNome);
    monthClientMap.set(monthKey, set);
  }

  const months = [...monthClientMap.entries()].sort().map(([month, clients]) => {
    let novos = 0;
    let recorrentes = 0;
    for (const cliente of clients) {
      const fp = firstPurchaseMonth.get(cliente);
      if (!fp || fp === month) novos++;
      else recorrentes++;
    }
    return { month, novos, recorrentes };
  });

  return { months, compraram1x, compraramMaisde1x };
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
