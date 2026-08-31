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
// Primeira compra HISTÓRICA de cada cliente, sem NENHUM filtro de loja/marca/tabela de preço —
// "cliente novo" sempre significa novo pra empresa inteira, nunca só dentro do filtro aplicado
// (decisão do Rodrigo em 2026-08-28, corrigindo um comportamento antigo onde filtrar por 1 loja
// podia marcar como "novo" um cliente que já comprava havia tempo em outra loja/marca). Mesma
// normalização de capitalização de getTopClientes (senão "Gringo"/"GRINGO" contam como 2
// primeiras-compras diferentes). Recebe os nomes JÁ normalizados (trim+upper).
//
// Também considera ClienteCadastro.primeiraCompraExterna (site antigo pré-DAPIC, importado em
// 2026-08-31 via scripts/backfill-primeira-compra-externa.ts) — sem isso, cliente que só voltou
// a comprar recentemente aparecia como "novo" mesmo já sendo cliente desde 2021-2023 (achado
// cruzando por CPF: 226 casos reais). Usa a data mais antiga entre as duas fontes.
async function getPrimeiraCompraGlobalPorCliente(nomesNormalizados: string[]): Promise<Map<string, Date>> {
  if (nomesNormalizados.length === 0) return new Map();
  const [saleRows, externaRows] = await Promise.all([
    prisma.$queryRaw<{ norm: string; first: Date }[]>`
      SELECT UPPER(TRIM("clienteNome")) AS norm, MIN("saleDate") AS first
      FROM "Sale"
      WHERE UPPER(TRIM("clienteNome")) = ANY(${nomesNormalizados})
      GROUP BY norm
    `,
    prisma.$queryRaw<{ norm: string; first: Date }[]>`
      SELECT UPPER(TRIM("nome")) AS norm, MIN("primeiraCompraExterna") AS first
      FROM "ClienteCadastro"
      WHERE "primeiraCompraExterna" IS NOT NULL AND UPPER(TRIM("nome")) = ANY(${nomesNormalizados})
      GROUP BY norm
    `,
  ]);
  const result = new Map<string, Date>();
  for (const r of saleRows) result.set(r.norm, new Date(r.first));
  for (const r of externaRows) {
    const d = new Date(r.first);
    const cur = result.get(r.norm);
    if (!cur || d < cur) result.set(r.norm, d);
  }
  return result;
}

// Data da venda mais antiga da base — só pra montar a lista de meses disponíveis no seletor de
// período da Segmentação (2026-08-31).
export async function getPrimeiraVendaData(): Promise<Date | null> {
  const rows = await prisma.$queryRaw<{ first: Date | null }[]>`SELECT MIN("saleDate") AS first FROM "Sale"`;
  return rows[0]?.first ? new Date(rows[0].first) : null;
}

export async function getNewClientsCount(filters: DashboardFilters) {
  const where: Prisma.SaleWhereInput = { ...saleWhere(filters), clienteNome: { not: null } };
  const clientesNoPeriodo = await prisma.sale.groupBy({ by: ["clienteNome"], where });
  const normSet = new Set(clientesNoPeriodo.map((c) => (c.clienteNome as string).trim().toUpperCase()));
  const primeiraGlobal = await getPrimeiraCompraGlobalPorCliente([...normSet]);
  let count = 0;
  for (const norm of normSet) {
    const first = primeiraGlobal.get(norm);
    if (first && first >= filters.from && first <= filters.to) count++;
  }
  return count;
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
  liquido = false,
  query?: string
) {
  const q = query?.trim();
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    clienteNome: q ? { contains: q, mode: "insensitive" } : { not: null },
    ...(vendedor ? { vendedor } : {}),
    ...(canal !== "todos" ? { AND: [canalWhere(canal)] } : {}),
  };
  const [rows, pedidosRows, devolvidoPorCliente] = await Promise.all([
    prisma.sale.groupBy({
      by: ["clienteNome"],
      where,
      _sum: { quantidade: true, valorTotalLiquido: true },
    }),
    // "Pedidos" precisa ser PEDIDO distinto (storeId+dapicVendaId), não linha de item — 1 pedido
    // pode ter vários produtos, cada um sua própria linha em Sale. Contar linhas (_count._all)
    // inflava até 40x em clientes de atacado com pedidos grandes (achado em 2026-08-28).
    prisma.sale.groupBy({ by: ["clienteNome", "storeId", "dapicVendaId"], where }),
    liquido && canal !== "b2b" ? getValorDevolvidoPorCliente(filters) : Promise.resolve(new Map<string, number>()),
  ]);

  // O mesmo cliente às vezes está cadastrado com maiúscula/minúscula diferente no DAPIC (ex:
  // "Gringo" e "GRINGO") — sem normalizar, o groupBy trata como 2 clientes distintos e fragmenta
  // a receita dele em duas linhas. Junta pelo nome normalizado, mantendo como nome de exibição
  // a variante com mais receita (a mais "oficial" das duas).
  type Merged = { cliente: string; unidades: number; receitaBruta: number; devolvido: number; melhorReceita: number; pedidos: Set<string> };
  const merged = new Map<string, Merged>();
  for (const r of rows) {
    const nome = r.clienteNome as string;
    const norm = nome.trim().toUpperCase();
    const unidades = r._sum.quantidade ?? 0;
    const receitaBruta = r._sum.valorTotalLiquido ?? 0;
    const devolvido = devolvidoPorCliente.get(nome) ?? 0;
    const cur = merged.get(norm);
    if (!cur) {
      merged.set(norm, { cliente: nome, unidades, receitaBruta, devolvido, melhorReceita: receitaBruta, pedidos: new Set() });
    } else {
      cur.unidades += unidades;
      cur.receitaBruta += receitaBruta;
      cur.devolvido += devolvido;
      if (receitaBruta > cur.melhorReceita) {
        cur.cliente = nome;
        cur.melhorReceita = receitaBruta;
      }
    }
  }
  for (const p of pedidosRows) {
    const norm = (p.clienteNome as string).trim().toUpperCase();
    merged.get(norm)?.pedidos.add(`${p.storeId}::${p.dapicVendaId}`);
  }

  const sorted = [...merged.values()]
    .map((m) => ({
      cliente: m.cliente,
      pedidos: m.pedidos.size,
      unidades: m.unidades,
      receitaBruta: m.receitaBruta,
      receitaLiquida: liquido ? m.receitaBruta - m.devolvido : m.receitaBruta,
    }))
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

// ===== CRM de Clientes (2026-08-28) =====

// KPIs da Visão Geral do CRM: ativos, novos (mesma regra de getNewClientsCount — 1ª compra da
// empresa inteira caiu no período), recorrentes (2+ pedidos, não-novo), ocasionais (1 pedido,
// não-novo), ticket médio, unidades por pedido, receita média por cliente.
export type ClientesCrmOverview = {
  ativos: number;
  novos: number;
  recorrentes: number;
  ocasionais: number;
  pedidos: number;
  unidades: number;
  receitaBruta: number;
  receitaLiquida: number;
  // ticketMedio e receitaMediaPorCliente usam líquida — pedido do Rodrigo em 2026-08-28.
  ticketMedio: number;
  unidadesPorPedido: number;
  receitaMediaPorCliente: number;
};

export async function getClientesCrmOverview(filters: DashboardFilters, canal: Canal = "todos"): Promise<ClientesCrmOverview> {
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    clienteNome: { not: null },
    ...(canal !== "todos" ? { AND: [canalWhere(canal)] } : {}),
  };

  const [porPedido, devolvidoPorCliente] = await Promise.all([
    prisma.sale.groupBy({
      by: ["clienteNome", "storeId", "dapicVendaId"],
      where,
      _sum: { quantidade: true, valorTotalLiquido: true },
    }),
    canal !== "b2b" ? getValorDevolvidoPorCliente(filters) : Promise.resolve(new Map<string, number>()),
  ]);

  const porClienteNorm = new Map<string, { pedidos: Set<string>; unidades: number; receita: number; devolvido: number }>();
  for (const r of porPedido) {
    const norm = (r.clienteNome as string).trim().toUpperCase();
    const cur = porClienteNorm.get(norm) ?? { pedidos: new Set<string>(), unidades: 0, receita: 0, devolvido: 0 };
    cur.pedidos.add(`${r.storeId}::${r.dapicVendaId}`);
    cur.unidades += r._sum.quantidade ?? 0;
    cur.receita += r._sum.valorTotalLiquido ?? 0;
    porClienteNorm.set(norm, cur);
  }
  // getValorDevolvidoPorCliente é por nome BRUTO (pode ter variante de capitalização diferente
  // da usada como chave normalizada acima) — soma dentro do bucket normalizado certo.
  for (const [nomeRaw, valor] of devolvidoPorCliente) {
    const cur = porClienteNorm.get(nomeRaw.trim().toUpperCase());
    if (cur) cur.devolvido += valor;
  }

  const primeiraGlobal = await getPrimeiraCompraGlobalPorCliente([...porClienteNorm.keys()]);

  let novos = 0, recorrentes = 0, ocasionais = 0;
  let totalPedidos = 0, totalUnidades = 0, totalReceitaBruta = 0, totalDevolvido = 0;
  for (const [norm, v] of porClienteNorm) {
    const first = primeiraGlobal.get(norm);
    const isNovo = first !== undefined && first >= filters.from && first <= filters.to;
    if (isNovo) novos++;
    else if (v.pedidos.size >= 2) recorrentes++;
    else ocasionais++;
    totalPedidos += v.pedidos.size;
    totalUnidades += v.unidades;
    totalReceitaBruta += v.receita;
    totalDevolvido += v.devolvido;
  }
  const totalReceitaLiquida = totalReceitaBruta - totalDevolvido;

  const ativos = porClienteNorm.size;
  return {
    ativos,
    novos,
    recorrentes,
    ocasionais,
    pedidos: totalPedidos,
    unidades: totalUnidades,
    receitaBruta: totalReceitaBruta,
    receitaLiquida: totalReceitaLiquida,
    ticketMedio: totalPedidos > 0 ? totalReceitaLiquida / totalPedidos : 0,
    unidadesPorPedido: totalPedidos > 0 ? totalUnidades / totalPedidos : 0,
    receitaMediaPorCliente: ativos > 0 ? totalReceitaLiquida / ativos : 0,
  };
}

export type ClienteSegmento = "novo" | "vip" | "recorrente" | "em_risco" | "ocasional" | "inativo";

export type ClienteSegmentado = {
  cliente: string;
  telefone: string | null;
  grupoPrincipal: string | null;
  recenciaDias: number;
  pedidos: number;
  receitaBruta: number;
  segmento: ClienteSegmento;
};

// Segmentação tipo RFM (Recência/Frequência/Valor) sem expor a sigla pro usuário — pedido do
// Rodrigo em 2026-08-28. Limiares calibrados contra a distribuição real da base (não são "regra
// de livro"): medi em 2026-08-28 que a mediana de recência é ~172 dias e 65% dos clientes tem
// só 1 pedido na vida toda — um corte tipo "90 dias = inativo" classificaria a maioria da base
// inteira como inativa, então os limiares abaixo (90/180 dias) foram escolhidos olhando esses
// percentis reais, não um valor arbitrário de manual de CRM.
//
// Usa o HISTÓRICO COMPLETO (ignora from/to do filtro) pra recência/frequência/valor E pra
// "novo" — só respeita loja/marca/tabela/canal do filtro. Sem isso, filtrar "últimos 30 dias"
// faria todo mundo parecer "recente", e usar from/to pra "novo" quebrava com o período padrão
// (que cobre o histórico inteiro desde set/2025) — todo cliente virava "novo" porque a 1ª
// compra de qualquer um sempre cai dentro de um período tão largo (achado testando em
// 2026-08-28: Segmentação toda zerada em VIP/Recorrente/etc, tudo empurrado pra "novo"). "Novo"
// aqui sempre usa uma janela fixa dos últimos NOVO_DIAS a partir de "referenceDate", não do
// período selecionado — sempre olhando a 1ª compra da empresa inteira (mesmo critério de
// getNewClientsCount), não só dentro do filtro de loja/marca/tabela.
//
// referenceDate = "foto tirada em que data" (pedido do Rodrigo em 2026-08-31, seletor de
// mês/período na Segmentação). Default é agora (comportamento de sempre). Quando é um mês
// passado, vira uma reconstrução histórica: todo o cálculo (recência, pedidos, receita, corte de
// VIP e a janela de "novo") passa a olhar só até o fim daquele mês, como se estivéssemos ali —
// SEM restringir a query a vendas só DAQUELE mês, senão um cliente antigo que não comprou
// especificamente naquele mês sumiria ou virataria "novo" por engano (exemplo do Rodrigo). O
// histórico anterior ao mês continua 100% visível pro cálculo, só o futuro (depois do mês) que
// fica de fora.
export async function getClienteSegmentacao(
  filters: DashboardFilters,
  canal: Canal = "todos",
  referenceDate: Date = new Date()
): Promise<ClienteSegmentado[]> {
  const allTime: DashboardFilters = { ...filters, from: new Date(0), to: referenceDate };
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(allTime),
    clienteNome: { not: null },
    ...(canal !== "todos" ? { AND: [canalWhere(canal)] } : {}),
  };
  const rows = await prisma.sale.findMany({
    where,
    select: { clienteNome: true, saleDate: true, dapicVendaId: true, storeId: true, valorTotalLiquido: true, quantidade: true, grupo: true },
  });

  const byCliente = new Map<string, { nome: string; last: Date; pedidos: Set<string>; receita: number; porGrupo: Map<string, number> }>();
  for (const r of rows) {
    const nome = r.clienteNome as string;
    const norm = nome.trim().toUpperCase();
    const cur = byCliente.get(norm) ?? { nome, last: r.saleDate, pedidos: new Set<string>(), receita: 0, porGrupo: new Map<string, number>() };
    if (r.saleDate > cur.last) cur.last = r.saleDate;
    cur.pedidos.add(`${r.storeId}::${r.dapicVendaId}`);
    cur.receita += r.valorTotalLiquido;
    cur.porGrupo.set(r.grupo, (cur.porGrupo.get(r.grupo) ?? 0) + r.quantidade);
    byCliente.set(norm, cur);
  }
  if (byCliente.size === 0) return [];

  // Pedidos/receita do site antigo (vnda) somam em cima do que o cliente já tem no DAPIC — pedido
  // do Rodrigo em 2026-08-31, mesmo raciocínio da Retenção: só entra em quem já existe aqui via
  // DAPIC (não cria cliente "fantasma" só de histórico antigo sem nenhuma compra atual). Sem
  // loja/marca/tabela/canal — essas dimensões não existem pro vnda.
  const historico = await prisma.vendaHistoricaExterna.findMany({
    where: { saleDate: { lte: referenceDate } },
    select: { clienteNome: true, pedidoExterno: true, valorTotal: true },
  });
  for (const h of historico) {
    const norm = h.clienteNome.trim().toUpperCase();
    const cur = byCliente.get(norm);
    if (!cur) continue;
    cur.pedidos.add(`vnda::${h.pedidoExterno}`);
    cur.receita += h.valorTotal;
  }

  const primeiraGlobal = await getPrimeiraCompraGlobalPorCliente([...byCliente.keys()]);
  // Telefone — mesmo enriquecimento de getTopClientes (join por nome com ClienteCadastro).
  const nomesRaw = [...byCliente.values()].map((c) => c.nome);
  const cadastros = await prisma.clienteCadastro.findMany({ where: { nome: { in: nomesRaw } } });
  const cadastroByNome = new Map(cadastros.map((c) => [c.nome, c]));

  const now = referenceDate;
  const receitaOrdenada = [...byCliente.values()].map((c) => c.receita).sort((a, b) => b - a);
  const corteVip = receitaOrdenada[Math.max(0, Math.floor(receitaOrdenada.length * 0.1) - 1)] ?? Infinity;

  const RECENCIA_ATIVO_DIAS = 90;
  const RECENCIA_INATIVO_DIAS = 180;
  const NOVO_DIAS = 60;

  return [...byCliente.entries()].map(([norm, c]) => {
    const recenciaDias = Math.floor((now.getTime() - c.last.getTime()) / 86400000);
    const pedidos = c.pedidos.size;
    const primeiraCompra = primeiraGlobal.get(norm);
    const diasDesdePrimeiraCompra = primeiraCompra ? Math.floor((now.getTime() - primeiraCompra.getTime()) / 86400000) : Infinity;
    const isNovo = diasDesdePrimeiraCompra <= NOVO_DIAS;

    let segmento: ClienteSegmento;
    if (isNovo) segmento = "novo";
    else if (recenciaDias > RECENCIA_INATIVO_DIAS) segmento = "inativo";
    else if (c.receita >= corteVip) segmento = "vip";
    else if (pedidos >= 2 && recenciaDias <= RECENCIA_ATIVO_DIAS) segmento = "recorrente";
    else if (pedidos >= 2) segmento = "em_risco";
    else segmento = "ocasional";

    const grupoPrincipal = [...c.porGrupo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const cad = cadastroByNome.get(c.nome);

    return {
      cliente: c.nome,
      telefone: cad?.telefone ?? cad?.celular ?? null,
      grupoPrincipal,
      recenciaDias,
      pedidos,
      receitaBruta: c.receita,
      segmento,
    };
  });
}

// Produtos comprados (líquido) por um lote de clientes — pedido do Rodrigo em 2026-08-31 pra
// dropdown na lista de Segmentação. Em lote (1 query pra todos os clientes da tela, nunca 1 por
// linha) — mesma ideia de getClienteFicha, mas resolvido pra N clientes de uma vez em vez de 1.
// Sempre histórico completo (mesmo critério de "primeira compra"/segmentação — não é o período do
// filtro), respeitando loja/marca/tabela do filtro atual.
export async function getProdutosLiquidosPorClientes(
  filters: Pick<DashboardFilters, "storeIds" | "marcas" | "tabelasPreco" | "grupoIn">,
  nomesClientes: string[]
): Promise<Map<string, { produto: string; unidades: number }[]>> {
  if (nomesClientes.length === 0) return new Map();
  const normalizedTargets = [...new Set(nomesClientes.map((n) => n.trim().toUpperCase()))];

  const variantRows = await prisma.$queryRaw<{ nome: string; norm: string }[]>`
    SELECT DISTINCT "clienteNome" AS nome, UPPER(TRIM("clienteNome")) AS norm
    FROM "Sale"
    WHERE UPPER(TRIM("clienteNome")) = ANY(${normalizedTargets})
  `;
  if (variantRows.length === 0) return new Map();
  const variantToNorm = new Map(variantRows.map((r) => [r.nome, r.norm]));
  const allVariants = variantRows.map((r) => r.nome);

  const allTime: DashboardFilters = { ...filters, from: new Date(0), to: new Date() };
  const where: Prisma.SaleWhereInput = { ...saleWhere(allTime), clienteNome: { in: allVariants } };
  const sales = await prisma.sale.findMany({
    where,
    select: { clienteNome: true, produto: true, quantidade: true, storeId: true, dapicVendaId: true },
  });
  if (sales.length === 0) return new Map();

  const porClienteProduto = new Map<string, Map<string, number>>();
  const pedidoToCliente = new Map<string, string>();
  for (const s of sales) {
    const norm = variantToNorm.get(s.clienteNome as string) ?? (s.clienteNome as string).trim().toUpperCase();
    const m = porClienteProduto.get(norm) ?? new Map<string, number>();
    m.set(s.produto, (m.get(s.produto) ?? 0) + s.quantidade);
    porClienteProduto.set(norm, m);
    pedidoToCliente.set(`${s.storeId}::${s.dapicVendaId}`, norm);
  }

  // Devolução — junta por storeId+dapicVendaId (Return não tem clienteNome) usando o mapa de
  // pedido→cliente que já montamos acima, então dá pra atribuir certo com 1 query só pra todos.
  const storeIds = [...new Set(sales.map((s) => s.storeId))];
  const vendaIds = [...new Set(sales.map((s) => s.dapicVendaId))];
  const returns = await prisma.return.findMany({
    where: { storeId: { in: storeIds }, dapicVendaId: { in: vendaIds } },
    select: { storeId: true, dapicVendaId: true, produto: true, quantidade: true },
  });
  for (const r of returns) {
    const norm = pedidoToCliente.get(`${r.storeId}::${r.dapicVendaId}`);
    if (!norm) continue;
    const m = porClienteProduto.get(norm);
    if (!m) continue;
    m.set(r.produto, (m.get(r.produto) ?? 0) - r.quantidade);
  }

  const result = new Map<string, { produto: string; unidades: number }[]>();
  for (const [norm, m] of porClienteProduto) {
    result.set(
      norm,
      [...m.entries()]
        .map(([produto, unidades]) => ({ produto, unidades }))
        .filter((p) => p.unidades !== 0)
        .sort((a, b) => b.unidades - a.unidades)
    );
  }
  return result;
}

export type ClientePrecoBehavior = "full_price" | "promo_driven" | "mixed" | "sem_dado";

// Tabelas reais confirmadas em produção em 2026-08-28 (Sale.tabelaPreco): "Tabela varejo",
// "Tabela atacado", "Promoção", "Black Friday 2025", mais null (tabela não inferida — 43-81%
// das vendas por mês, taxa alta e constante, não é só resíduo de backfill antigo).
const TABELAS_PROMOCIONAIS = new Set(["Promoção", "Black Friday 2025"]);
const TABELAS_CHEIAS = new Set(["Tabela varejo", "Tabela atacado"]);
// Cliente só recebe rótulo se tiver pelo menos essa quantidade de vendas com tabela
// identificada — com a taxa de null alta, classificar com 1-2 vendas seria pouco confiável.
const MIN_VENDAS_COM_TABELA = 3;

function classificarComportamentoPreco(receitaCheio: number, receitaPromo: number, vendasComTabela: number): ClientePrecoBehavior {
  if (vendasComTabela < MIN_VENDAS_COM_TABELA) return "sem_dado";
  const total = receitaCheio + receitaPromo;
  if (total <= 0) return "sem_dado";
  const pctPromo = receitaPromo / total;
  if (pctPromo >= 0.8) return "promo_driven";
  if (pctPromo <= 0.2) return "full_price";
  return "mixed";
}

// Full Price / Promo Driven / Mixed por cliente, em massa (usado na Segmentação da CRM). Só
// classifica quem tem dado suficiente (ver MIN_VENDAS_COM_TABELA) — o resto vira "sem_dado" em
// vez de arriscar um rótulo errado com pouca informação.
export async function getClientesPrecoBehavior(
  filters: DashboardFilters,
  canal: Canal = "todos"
): Promise<Map<string, ClientePrecoBehavior>> {
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    clienteNome: { not: null },
    ...(canal !== "todos" ? { AND: [canalWhere(canal)] } : {}),
  };
  const rows = await prisma.sale.groupBy({
    by: ["clienteNome", "tabelaPreco"],
    where,
    _sum: { valorTotalLiquido: true },
    _count: { _all: true },
  });

  const byCliente = new Map<string, { cheio: number; promo: number; comTabela: number }>();
  for (const r of rows) {
    const norm = (r.clienteNome as string).trim().toUpperCase();
    const cur = byCliente.get(norm) ?? { cheio: 0, promo: 0, comTabela: 0 };
    if (r.tabelaPreco !== null) {
      cur.comTabela += r._count._all;
      const valor = r._sum.valorTotalLiquido ?? 0;
      if (TABELAS_PROMOCIONAIS.has(r.tabelaPreco)) cur.promo += valor;
      else if (TABELAS_CHEIAS.has(r.tabelaPreco)) cur.cheio += valor;
    }
    byCliente.set(norm, cur);
  }

  const result = new Map<string, ClientePrecoBehavior>();
  for (const [norm, v] of byCliente) {
    result.set(norm, classificarComportamentoPreco(v.cheio, v.promo, v.comTabela));
  }
  return result;
}

// "Quem compra esse produto/grupo?" — mesmo padrão de normalização de getTopClientes, mas
// agrupado por produto/grupo específico em vez do total do cliente.
export async function getClientesPorDimensao(
  filters: DashboardFilters,
  dimension: "produto" | "grupo",
  keys: string[],
  canal: Canal = "todos",
  limit = 20
) {
  if (keys.length === 0) return [];
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    clienteNome: { not: null },
    ...(dimension === "produto" ? { produto: { in: keys } } : { grupo: { in: keys } }),
    ...(canal !== "todos" ? { AND: [canalWhere(canal)] } : {}),
  };
  const rows = await prisma.sale.groupBy({
    by: ["clienteNome"],
    where,
    _sum: { quantidade: true, valorTotalLiquido: true },
  });

  const merged = new Map<string, { cliente: string; unidades: number; receita: number }>();
  for (const r of rows) {
    const nome = r.clienteNome as string;
    const norm = nome.trim().toUpperCase();
    const unidades = r._sum.quantidade ?? 0;
    const receita = r._sum.valorTotalLiquido ?? 0;
    const cur = merged.get(norm);
    if (!cur) {
      merged.set(norm, { cliente: nome, unidades, receita });
    } else {
      cur.unidades += unidades;
      cur.receita += receita;
    }
  }
  const sorted = [...merged.values()].sort((a, b) => b.receita - a.receita).slice(0, limit);

  // Telefone — mesmo enriquecimento de getTopClientes (pedido do Rodrigo em 2026-08-28: telefone
  // em toda visão que lista cliente).
  const nomes = sorted.map((r) => r.cliente);
  const cadastros = await prisma.clienteCadastro.findMany({ where: { nome: { in: nomes } } });
  const cadastroByNome = new Map(cadastros.map((c) => [c.nome, c]));
  return sorted.map((r) => {
    const cad = cadastroByNome.get(r.cliente);
    return { ...r, telefone: cad?.telefone ?? cad?.celular ?? null };
  });
}

export type CrossSellResumo = {
  totalClientes: number;
  unidadesBrutas: number;
  unidadesLiquidas: number;
  receitaBruta: number;
  receitaLiquida: number;
};

export type CrossSellItem = {
  key: string;
  unidadesBrutas: number;
  unidadesLiquidas: number;
  receitaBruta: number;
  receitaLiquida: number;
};

export type CrossSellResult = {
  resumo: CrossSellResumo;
  produtosRelacionados: CrossSellItem[];
  gruposRelacionados: CrossSellItem[];
};

// Cross-sell: "quem comprou X, o que mais compra?" — pedido do Rodrigo em 2026-08-31. Reutiliza
// saleWhere/canalWhere (mesma regra B2B/B2C oficial de sempre) e o mesmo padrão de netagem de
// devolução por produto/grupo já usado em getClienteFicha (junta Return por storeId+dapicVendaId,
// já que Return não tem clienteNome).
//
// Passo a passo: 1) acha quem comprou os produtos/grupos selecionados (dimension+keys) dentro do
// filtro/canal; 2) busca TODAS as compras desses clientes no mesmo filtro/canal (não só do que
// selecionou — é isso que vira a base do cross-sell); 3) agrega por produto e por grupo; 4) neta
// devolução (sempre B2C — pedidos.length 0 em canal="b2b" pula a query inteira, mesma regra usada
// em getClientesCrmOverview); 5) exclui os próprios produtos/grupos selecionados do ranking da
// MESMA dimensão (não teria sentido dizer "quem compra Camisa X também compra Camisa X").
export async function getCrossSellPorDimensao(
  filters: DashboardFilters,
  dimension: "produto" | "grupo",
  keys: string[],
  canal: Canal = "todos",
  limit = 20
): Promise<CrossSellResult> {
  const vazio: CrossSellResult = {
    resumo: { totalClientes: 0, unidadesBrutas: 0, unidadesLiquidas: 0, receitaBruta: 0, receitaLiquida: 0 },
    produtosRelacionados: [],
    gruposRelacionados: [],
  };
  if (keys.length === 0) return vazio;

  const baseWhere: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    clienteNome: { not: null },
    ...(canal !== "todos" ? { AND: [canalWhere(canal)] } : {}),
  };

  const compradoresRows = await prisma.sale.groupBy({
    by: ["clienteNome"],
    where: { ...baseWhere, ...(dimension === "produto" ? { produto: { in: keys } } : { grupo: { in: keys } }) },
  });
  if (compradoresRows.length === 0) return vazio;
  const normalizedSet = new Set(compradoresRows.map((r) => (r.clienteNome as string).trim().toUpperCase()));

  const variantRows = await prisma.$queryRaw<{ nome: string }[]>`
    SELECT DISTINCT "clienteNome" AS nome FROM "Sale" WHERE UPPER(TRIM("clienteNome")) = ANY(${[...normalizedSet]})
  `;
  const variantes = variantRows.map((r) => r.nome);

  // TUDO que esses clientes compraram no mesmo período/filtro/canal — não só o produto/grupo
  // selecionado. É a base do "o que mais eles compram".
  const todasComprasRows = await prisma.sale.findMany({
    where: { ...baseWhere, clienteNome: { in: variantes } },
    select: { storeId: true, dapicVendaId: true, produto: true, grupo: true, quantidade: true, valorTotalLiquido: true },
  });

  const porProduto = new Map<string, { unidades: number; receita: number }>();
  const porGrupo = new Map<string, { unidades: number; receita: number }>();
  const pedidoKeys = new Set<string>();
  const storeIdsCliente = new Set<string>();
  const dapicVendaIdsCliente = new Set<number>();
  for (const s of todasComprasRows) {
    const p = porProduto.get(s.produto) ?? { unidades: 0, receita: 0 };
    p.unidades += s.quantidade;
    p.receita += s.valorTotalLiquido;
    porProduto.set(s.produto, p);

    const g = porGrupo.get(s.grupo) ?? { unidades: 0, receita: 0 };
    g.unidades += s.quantidade;
    g.receita += s.valorTotalLiquido;
    porGrupo.set(s.grupo, g);

    pedidoKeys.add(`${s.storeId}::${s.dapicVendaId}`);
    storeIdsCliente.add(s.storeId);
    dapicVendaIdsCliente.add(s.dapicVendaId);
  }

  // Devolução é sempre B2C (regra confirmada com o Rodrigo) — em canal="b2b" não existe, pula a
  // query. Junta por storeId+dapicVendaId (Return não tem clienteNome) restrito aos pedidos
  // desses clientes especificamente.
  const devolvidoPorProduto = new Map<string, { unidades: number; valor: number }>();
  const devolvidoPorGrupo = new Map<string, { unidades: number; valor: number }>();
  if (canal !== "b2b" && pedidoKeys.size > 0) {
    const returns = await prisma.return.findMany({
      where: { storeId: { in: [...storeIdsCliente] }, dapicVendaId: { in: [...dapicVendaIdsCliente] } },
      select: { storeId: true, dapicVendaId: true, produto: true, grupo: true, quantidade: true, valorTotal: true },
    });
    for (const r of returns) {
      if (!pedidoKeys.has(`${r.storeId}::${r.dapicVendaId}`)) continue;
      const p = devolvidoPorProduto.get(r.produto) ?? { unidades: 0, valor: 0 };
      p.unidades += r.quantidade;
      p.valor += r.valorTotal;
      devolvidoPorProduto.set(r.produto, p);

      const g = devolvidoPorGrupo.get(r.grupo) ?? { unidades: 0, valor: 0 };
      g.unidades += r.quantidade;
      g.valor += r.valorTotal;
      devolvidoPorGrupo.set(r.grupo, g);
    }
  }

  // Resumo do produto/grupo selecionado (líquido) — extrai dos mesmos mapas acima, já que
  // todasComprasRows inclui a compra do produto/grupo selecionado também.
  let resumoUnidadesBrutas = 0, resumoUnidadesLiquidas = 0, resumoReceitaBruta = 0, resumoReceitaLiquida = 0;
  for (const key of keys) {
    const bruto = dimension === "produto" ? porProduto.get(key) : porGrupo.get(key);
    if (!bruto) continue;
    const dev = (dimension === "produto" ? devolvidoPorProduto.get(key) : devolvidoPorGrupo.get(key)) ?? { unidades: 0, valor: 0 };
    resumoUnidadesBrutas += bruto.unidades;
    resumoUnidadesLiquidas += bruto.unidades - dev.unidades;
    resumoReceitaBruta += bruto.receita;
    resumoReceitaLiquida += bruto.receita - dev.valor;
  }

  const keysSet = new Set(keys);
  const produtosRelacionados = [...porProduto.entries()]
    .filter(([produto]) => !(dimension === "produto" && keysSet.has(produto)))
    .map(([produto, v]) => {
      const dev = devolvidoPorProduto.get(produto) ?? { unidades: 0, valor: 0 };
      return {
        key: produto,
        unidadesBrutas: v.unidades,
        unidadesLiquidas: v.unidades - dev.unidades,
        receitaBruta: v.receita,
        receitaLiquida: v.receita - dev.valor,
      };
    })
    .filter((p) => p.unidadesLiquidas !== 0)
    .sort((a, b) => b.receitaLiquida - a.receitaLiquida)
    .slice(0, limit);

  const gruposRelacionados = [...porGrupo.entries()]
    .filter(([grupo]) => !(dimension === "grupo" && keysSet.has(grupo)))
    .map(([grupo, v]) => {
      const dev = devolvidoPorGrupo.get(grupo) ?? { unidades: 0, valor: 0 };
      return {
        key: grupo,
        unidadesBrutas: v.unidades,
        unidadesLiquidas: v.unidades - dev.unidades,
        receitaBruta: v.receita,
        receitaLiquida: v.receita - dev.valor,
      };
    })
    .filter((g) => g.unidadesLiquidas !== 0)
    .sort((a, b) => b.receitaLiquida - a.receitaLiquida);

  return {
    resumo: {
      totalClientes: normalizedSet.size,
      unidadesBrutas: resumoUnidadesBrutas,
      unidadesLiquidas: resumoUnidadesLiquidas,
      receitaBruta: resumoReceitaBruta,
      receitaLiquida: resumoReceitaLiquida,
    },
    produtosRelacionados,
    gruposRelacionados,
  };
}

export type ProdutoEntradaItem = {
  produto: string;
  clientes: number;
  unidades: number;
  receita: number;
};

export type ProdutosEntradaResult = {
  primeiraCompra: ProdutoEntradaItem[];
  compradorUnico: ProdutoEntradaItem[];
};

// "Produtos de Entrada" — pedido do Rodrigo em 2026-08-31: não é "o que mais vende" nem
// cross-sell, é "que produto mais TRAZ cliente novo". Duas visões, pedidas juntas:
// 1) primeiraCompra: pra cada cliente, o produto da 1ª linha de venda dele (cronologicamente) —
//    simplificação deliberada: se o 1º pedido tiver vários produtos, conta só o 1º item (por
//    saleDate, empate resolvido por dapicVendaId) — o caso de "1º pedido com vários produtos
//    diferentes no mesmo instante" é raro e não vale a complexidade de contar todos.
// 2) compradorUnico: o mesmo recorte, restrito a clientes com exatamente 1 pedido NA VIDA TODA
//    (nunca voltaram) — como a primeira compra desses é também a única, reusa a mesma linha, sem
//    query extra.
// "Primeira compra" é sempre GLOBAL (sem filtro de loja/marca/tabela/período) — mesmo critério de
// "cliente novo" já usado no resto do CRM (decisão do Rodrigo em 2026-08-28). Os filtros da
// página (loja/marca/tabela/canal/período) só decidem se AQUELA linha entra no ranking, nunca
// qual foi a primeira. Não neta devolução — a pergunta é "esse produto trouxe o cliente pra
// dentro", uma devolução posterior não desfaz a aquisição.
export async function getProdutosPortaDeEntrada(
  filters: DashboardFilters,
  canal: Canal = "todos",
  limit = 20
): Promise<ProdutosEntradaResult> {
  const [firstRows, pedidoCounts] = await Promise.all([
    prisma.$queryRaw<
      { norm: string; produto: string; grupo: string; storeId: string; marca: string | null; tabelaPreco: string | null; saleDate: Date; quantidade: number; valorTotalLiquido: number }[]
    >`
      SELECT DISTINCT ON (norm)
        norm, produto, grupo, "storeId", marca, "tabelaPreco", "saleDate", quantidade, "valorTotalLiquido"
      FROM (
        SELECT
          UPPER(TRIM("clienteNome")) AS norm, "produto", "grupo", "storeId", "marca", "tabelaPreco",
          "saleDate", "quantidade", "valorTotalLiquido", "dapicVendaId"
        FROM "Sale"
        WHERE "clienteNome" IS NOT NULL
      ) t
      ORDER BY norm, "saleDate" ASC, "dapicVendaId" ASC
    `,
    prisma.$queryRaw<{ norm: string; pedidos: bigint }[]>`
      SELECT UPPER(TRIM("clienteNome")) AS norm, COUNT(DISTINCT ("storeId", "dapicVendaId")) AS pedidos
      FROM "Sale"
      WHERE "clienteNome" IS NOT NULL
      GROUP BY norm
    `,
  ]);
  const pedidosByNorm = new Map(pedidoCounts.map((r) => [r.norm, Number(r.pedidos)]));

  function passaFiltro(r: (typeof firstRows)[number]): boolean {
    if (r.saleDate < filters.from || r.saleDate > filters.to) return false;
    if (filters.storeIds !== undefined && !filters.storeIds.includes(r.storeId)) return false;
    if (filters.marcas !== undefined && (r.marca === null || !filters.marcas.includes(r.marca))) return false;
    if (filters.tabelasPreco !== undefined && r.tabelaPreco !== null && !filters.tabelasPreco.includes(r.tabelaPreco)) return false;
    if (filters.grupoIn && !filters.grupoIn.includes(r.grupo)) return false;
    if (canal === "b2b" && r.tabelaPreco !== "Tabela atacado") return false;
    if (canal === "b2c" && r.tabelaPreco === "Tabela atacado") return false;
    return true;
  }

  const porProdutoPrimeira = new Map<string, { clientes: Set<string>; unidades: number; receita: number }>();
  const porProdutoUnico = new Map<string, { clientes: Set<string>; unidades: number; receita: number }>();
  for (const r of firstRows) {
    if (!passaFiltro(r)) continue;
    const cur = porProdutoPrimeira.get(r.produto) ?? { clientes: new Set<string>(), unidades: 0, receita: 0 };
    cur.clientes.add(r.norm);
    cur.unidades += r.quantidade;
    cur.receita += r.valorTotalLiquido;
    porProdutoPrimeira.set(r.produto, cur);

    if ((pedidosByNorm.get(r.norm) ?? 0) === 1) {
      const curU = porProdutoUnico.get(r.produto) ?? { clientes: new Set<string>(), unidades: 0, receita: 0 };
      curU.clientes.add(r.norm);
      curU.unidades += r.quantidade;
      curU.receita += r.valorTotalLiquido;
      porProdutoUnico.set(r.produto, curU);
    }
  }

  function toSorted(map: Map<string, { clientes: Set<string>; unidades: number; receita: number }>): ProdutoEntradaItem[] {
    return [...map.entries()]
      .map(([produto, v]) => ({ produto, clientes: v.clientes.size, unidades: v.unidades, receita: v.receita }))
      .sort((a, b) => b.clientes - a.clientes)
      .slice(0, limit);
  }

  return {
    primeiraCompra: toSorted(porProdutoPrimeira),
    compradorUnico: toSorted(porProdutoUnico),
  };
}

export type ClienteFicha = {
  cliente: string;
  telefone: string | null;
  email: string | null;
  cpfCnpj: string | null;
  dataNascimento: Date | null;
  cidade: string | null;
  estado: string | null;
  receitaBruta: number;
  receitaLiquida: number;
  pedidos: number;
  pedidosLiquidos: number;
  pedidosB2B: number;
  pedidosB2C: number;
  ticketMedio: number;
  primeiraCompra: Date;
  primeiraCompraFonte: "dapic" | "site_antigo";
  ultimaCompra: Date;
  receitaB2B: number;
  receitaB2C: number;
  unidadesBrutas: number;
  unidadesLiquidas: number;
  comportamentoPreco: ClientePrecoBehavior;
  topGrupos: {
    grupo: string;
    unidadesBrutas: number;
    unidadesLiquidas: number;
    receitaBruta: number;
    receitaLiquida: number;
  }[];
  topProdutos: {
    produto: string;
    unidadesBrutas: number;
    unidadesLiquidas: number;
    receitaBruta: number;
    receitaLiquida: number;
  }[];
  topTamanhos: { tamanho: string; unidades: number }[];
  topLojas: { loja: string; pedidos: number }[];
  // bruta — devolução não é atribuída a mês aqui (só ao produto, ver comentário na função).
  historicoMensal: { month: string; receita: number; unidades: number }[];
};

// Ficha do cliente: histórico COMPLETO (não o período do filtro — uma ficha é um perfil, não um
// recorte), respeitando só loja/marca/tabela/grupo do filtro atual. Busca todas as variantes de
// capitalização do nome primeiro (raw SQL, único jeito de casar por nome normalizado no Prisma),
// depois usa elas num `in` normal — evita reescrever a query inteira em SQL cru.
export async function getClienteFicha(
  filters: Pick<DashboardFilters, "storeIds" | "marcas" | "tabelasPreco" | "grupoIn">,
  busca: string
): Promise<ClienteFicha | null> {
  let norm = busca.trim().toUpperCase();
  if (!norm) return null;

  let variantRows = await prisma.$queryRaw<{ nome: string }[]>`
    SELECT DISTINCT "clienteNome" AS nome FROM "Sale" WHERE UPPER(TRIM("clienteNome")) = ${norm}
  `;
  // Se não achou por nome exato, tenta como CPF/CNPJ — compara só os dígitos (o cadastro guarda
  // formatado, ex: "098.286.597-00", o Rodrigo pode digitar com ou sem pontuação).
  if (variantRows.length === 0) {
    const somenteDigitos = busca.replace(/\D/g, "");
    if (somenteDigitos.length >= 8) {
      const cadastroPorCpf = await prisma.$queryRaw<{ nome: string }[]>`
        SELECT "nome" FROM "ClienteCadastro" WHERE regexp_replace("cpfCnpj", '[^0-9]', '', 'g') = ${somenteDigitos} LIMIT 1
      `;
      if (cadastroPorCpf.length > 0) {
        norm = cadastroPorCpf[0].nome.trim().toUpperCase();
        variantRows = await prisma.$queryRaw<{ nome: string }[]>`
          SELECT DISTINCT "clienteNome" AS nome FROM "Sale" WHERE UPPER(TRIM("clienteNome")) = ${norm}
        `;
      }
    }
  }
  if (variantRows.length === 0) return null;
  const variantes = variantRows.map((r) => r.nome);

  const allTime: DashboardFilters = {
    storeIds: filters.storeIds,
    marcas: filters.marcas,
    tabelasPreco: filters.tabelasPreco,
    grupoIn: filters.grupoIn,
    from: new Date(0),
    to: new Date(),
  };
  const where: Prisma.SaleWhereInput = { ...saleWhere(allTime), clienteNome: { in: variantes } };

  const [sales, cadastro, historicoLocal] = await Promise.all([
    prisma.sale.findMany({
      where,
      select: {
        saleDate: true, dapicVendaId: true, storeId: true, valorTotalLiquido: true,
        quantidade: true, tabelaPreco: true, produto: true, tamanho: true, grupo: true, cidade: true, estado: true,
        store: { select: { name: true, displayGroup: true } },
      },
    }),
    prisma.clienteCadastro.findMany({ where: { nome: { in: variantes } } }),
    // site antigo não tem "variantes" de nome pré-computadas (não é indexado por Sale) — casa
    // direto pelo mesmo conjunto de nomes normalizados já resolvido acima.
    prisma.vendaHistoricaExterna.findMany({
      where: { clienteNome: { in: variantes } },
      select: { saleDate: true, cidade: true, estado: true },
    }),
  ]);
  if (sales.length === 0) return null;

  // "De onde é" — pega o estado/cidade mais recente entre DAPIC e site antigo (não é endereço
  // fixo, é o que veio no pedido mais recente que tinha esse dado). Pedido do Rodrigo em
  // 2026-08-31.
  let estadoInfo: { cidade: string | null; estado: string; data: Date } | null = null;
  for (const s of sales) {
    if (s.estado && (!estadoInfo || s.saleDate > estadoInfo.data)) {
      estadoInfo = { cidade: s.cidade, estado: s.estado, data: s.saleDate };
    }
  }
  for (const h of historicoLocal) {
    if (h.estado && (!estadoInfo || h.saleDate > estadoInfo.data)) {
      estadoInfo = { cidade: h.cidade, estado: h.estado, data: h.saleDate };
    }
  }

  const pedidos = new Set<string>();
  // true = pelo menos 1 item do pedido é B2B (Tabela atacado) — pedido misto é raro, mas conta
  // como B2B se tiver qualquer item assim.
  const pedidoCanal = new Map<string, boolean>();
  let unidadesBrutas = 0, receitaBruta = 0, receitaB2B = 0, receitaB2C = 0;
  let primeiraCompra = sales[0].saleDate, ultimaCompra = sales[0].saleDate;
  let cheio = 0, promo = 0, comTabela = 0;
  const porProduto = new Map<string, { unidades: number; receita: number }>();
  const porGrupo = new Map<string, { unidades: number; receita: number }>();
  const porTamanho = new Map<string, number>();
  // Card resumido de "onde comprou" (agregado, não por produto) — pedido do Rodrigo em
  // 2026-08-28: a quebra por produto tinha sido tirada por ficar detalhada demais, mas ele quis
  // de volta um resumo geral de lojas.
  const porLoja = new Map<string, number>();
  const porMes = new Map<string, { receita: number; unidades: number }>();
  const pedidoKeys = new Set<string>();
  const storeIdToLoja = new Map<string, string>();
  // "Onde comprou" virou contagem de pedidos, não de peças (pedido do Rodrigo em 2026-08-28) —
  // pedido pertence a 1 loja só (mesmo storeId), então dá pra contar direto por pedidoKey.
  const pedidoKeyToLoja = new Map<string, string>();
  const pedidoUnidadesBruto = new Map<string, number>();

  for (const s of sales) {
    const pedidoKey = `${s.storeId}::${s.dapicVendaId}`;
    pedidos.add(pedidoKey);
    pedidoKeys.add(pedidoKey);
    pedidoUnidadesBruto.set(pedidoKey, (pedidoUnidadesBruto.get(pedidoKey) ?? 0) + s.quantidade);
    const isB2BLine = s.tabelaPreco === "Tabela atacado";
    pedidoCanal.set(pedidoKey, isB2BLine || (pedidoCanal.get(pedidoKey) ?? false));
    unidadesBrutas += s.quantidade;
    receitaBruta += s.valorTotalLiquido;
    if (isB2BLine) receitaB2B += s.valorTotalLiquido;
    else receitaB2C += s.valorTotalLiquido;
    if (s.saleDate < primeiraCompra) primeiraCompra = s.saleDate;
    if (s.saleDate > ultimaCompra) ultimaCompra = s.saleDate;
    if (s.tabelaPreco !== null) {
      comTabela++;
      if (TABELAS_PROMOCIONAIS.has(s.tabelaPreco)) promo += s.valorTotalLiquido;
      else if (TABELAS_CHEIAS.has(s.tabelaPreco)) cheio += s.valorTotalLiquido;
    }

    const p = porProduto.get(s.produto) ?? { unidades: 0, receita: 0 };
    p.unidades += s.quantidade;
    p.receita += s.valorTotalLiquido;
    porProduto.set(s.produto, p);

    const g = porGrupo.get(s.grupo) ?? { unidades: 0, receita: 0 };
    g.unidades += s.quantidade;
    g.receita += s.valorTotalLiquido;
    porGrupo.set(s.grupo, g);

    const tamanho = s.tamanho && s.tamanho.trim() ? s.tamanho : "—";
    porTamanho.set(tamanho, (porTamanho.get(tamanho) ?? 0) + s.quantidade);

    const loja = s.store.displayGroup ?? s.store.name;
    porLoja.set(loja, (porLoja.get(loja) ?? 0) + s.quantidade);
    storeIdToLoja.set(s.storeId, loja);
    pedidoKeyToLoja.set(pedidoKey, loja);

    const mes = s.saleDate.toISOString().slice(0, 7);
    const m = porMes.get(mes) ?? { receita: 0, unidades: 0 };
    m.receita += s.valorTotalLiquido;
    m.unidades += s.quantidade;
    porMes.set(mes, m);
  }

  let pedidosB2B = 0, pedidosB2C = 0;
  for (const isB2B of pedidoCanal.values()) {
    if (isB2B) pedidosB2B++;
    else pedidosB2C++;
  }

  // Devolução, por produto — Return não tem clienteNome, mas junta com os pedidos (storeId +
  // dapicVendaId) desse cliente que já buscamos acima. Return já tem seu próprio campo
  // "produto" (não precisa mais nada da Sale pra saber o quê foi devolvido), então dá pra netar
  // certo por produto, não só o total do cliente — antes "Produtos mais comprados" ficava bruto
  // mesmo com o resumo do topo mostrando líquida, número inconsistente na mesma tela.
  const storeIdsCliente = [...new Set(sales.map((s) => s.storeId))];
  const dapicVendaIdsCliente = [...new Set(sales.map((s) => s.dapicVendaId))];
  const returnsCliente = dapicVendaIdsCliente.length > 0
    ? await prisma.return.findMany({
        where: { storeId: { in: storeIdsCliente }, dapicVendaId: { in: dapicVendaIdsCliente } },
        select: { storeId: true, dapicVendaId: true, produto: true, tamanho: true, grupo: true, quantidade: true, valorTotal: true },
      })
    : [];
  const devolvidoPorProduto = new Map<string, { unidades: number; valor: number }>();
  const devolvidoPorGrupo = new Map<string, { unidades: number; valor: number }>();
  // Mesma netagem por produto, agora também por grupo, tamanho e loja — pedido do Rodrigo em
  // 2026-08-28: "onde comprou" e "tamanhos mais comprados" ficaram brutos enquanto o resto da
  // ficha já tinha virado líquido, inconsistente na mesma tela.
  const devolvidoPorTamanho = new Map<string, number>();
  const devolvidoPorLoja = new Map<string, number>();
  const pedidoUnidadesDevolvido = new Map<string, number>();
  let devolvidoUnidadesTotal = 0, devolvidoValorTotal = 0;
  for (const r of returnsCliente) {
    const pedidoKey = `${r.storeId}::${r.dapicVendaId}`;
    if (!pedidoKeys.has(pedidoKey)) continue;
    const cur = devolvidoPorProduto.get(r.produto) ?? { unidades: 0, valor: 0 };
    cur.unidades += r.quantidade;
    cur.valor += r.valorTotal;
    devolvidoPorProduto.set(r.produto, cur);

    const curGrupo = devolvidoPorGrupo.get(r.grupo) ?? { unidades: 0, valor: 0 };
    curGrupo.unidades += r.quantidade;
    curGrupo.valor += r.valorTotal;
    devolvidoPorGrupo.set(r.grupo, curGrupo);

    const tamanho = r.tamanho && r.tamanho.trim() ? r.tamanho : "—";
    devolvidoPorTamanho.set(tamanho, (devolvidoPorTamanho.get(tamanho) ?? 0) + r.quantidade);

    const loja = storeIdToLoja.get(r.storeId);
    if (loja) devolvidoPorLoja.set(loja, (devolvidoPorLoja.get(loja) ?? 0) + r.quantidade);

    pedidoUnidadesDevolvido.set(pedidoKey, (pedidoUnidadesDevolvido.get(pedidoKey) ?? 0) + r.quantidade);

    devolvidoUnidadesTotal += r.quantidade;
    devolvidoValorTotal += r.valorTotal;
  }

  // Pedido só conta como "líquido" (aqui e em "onde comprou") se sobrou saldo positivo depois da
  // devolução — pedido 100% devolvido não é um "pedido comprado" de verdade. KPI "Pedidos" no topo
  // usa isso como valor principal, com o bruto (pedidos.size) como subtexto — pedido do Rodrigo em
  // 2026-08-28, achou estranho o KPI bruto não bater com a soma de "onde comprou" (líquida).
  const pedidosPorLoja = new Map<string, number>();
  let pedidosLiquidos = 0;
  for (const [pedidoKey, bruto] of pedidoUnidadesBruto) {
    const liquido = bruto - (pedidoUnidadesDevolvido.get(pedidoKey) ?? 0);
    if (liquido <= 0) continue;
    pedidosLiquidos++;
    const loja = pedidoKeyToLoja.get(pedidoKey);
    if (!loja) continue;
    pedidosPorLoja.set(loja, (pedidosPorLoja.get(loja) ?? 0) + 1);
  }

  const cad = cadastro[0];
  // Nome de exibição: a variante de capitalização mais longa (heurística simples — geralmente é
  // a mais "completa", ex: prefere "João Tardim" a "JOAO TARDIM" só quando ambas tem o mesmo
  // tamanho não dá pra saber qual é a "certa" mesmo, mas na prática resolve a maioria dos casos).
  const nomeExibicao = [...variantes].sort((a, b) => b.length - a.length)[0] ?? busca;

  // Considera a 1ª compra pré-DAPIC (site antigo, ver getPrimeiraCompraGlobalPorCliente) também
  // na ficha — senão o card mostraria uma data mais recente que o real pra quem já era cliente
  // desde 2021-2023. Guarda a fonte pra mostrar um selo na tela (pedido do Rodrigo em 2026-08-31,
  // pra deixar visível que aquele dado veio do site antigo, já que a correção em si é invisível).
  let primeiraCompraFonte: "dapic" | "site_antigo" = "dapic";
  for (const c of cadastro) {
    if (c.primeiraCompraExterna && c.primeiraCompraExterna < primeiraCompra) {
      primeiraCompra = c.primeiraCompraExterna;
      primeiraCompraFonte = "site_antigo";
    }
  }

  return {
    cliente: nomeExibicao,
    telefone: cad?.telefone ?? cad?.celular ?? null,
    email: cad?.email ?? null,
    cpfCnpj: cad?.cpfCnpj ?? null,
    dataNascimento: cad?.dataNascimento ?? null,
    cidade: estadoInfo?.cidade ?? null,
    estado: estadoInfo?.estado ?? null,
    receitaBruta,
    receitaLiquida: receitaBruta - devolvidoValorTotal,
    unidadesBrutas,
    unidadesLiquidas: unidadesBrutas - devolvidoUnidadesTotal,
    pedidos: pedidos.size,
    pedidosLiquidos,
    pedidosB2B,
    pedidosB2C,
    // Líquido/líquido: receita líquida dividida por pedidos líquidos (pedido 100% devolvido não
    // deveria "puxar pra baixo" o ticket médio de quem ele nem chegou a ficar com nada).
    ticketMedio: pedidosLiquidos > 0 ? (receitaBruta - devolvidoValorTotal) / pedidosLiquidos : 0,
    primeiraCompra,
    primeiraCompraFonte,
    ultimaCompra,
    receitaB2B,
    receitaB2C,
    comportamentoPreco: classificarComportamentoPreco(cheio, promo, comTabela),
    topGrupos: [...porGrupo.entries()]
      .map(([grupo, v]) => {
        const dev = devolvidoPorGrupo.get(grupo) ?? { unidades: 0, valor: 0 };
        return {
          grupo,
          unidadesBrutas: v.unidades,
          unidadesLiquidas: v.unidades - dev.unidades,
          receitaBruta: v.receita,
          receitaLiquida: v.receita - dev.valor,
        };
      })
      .filter((g) => g.unidadesLiquidas !== 0)
      .sort((a, b) => b.receitaLiquida - a.receitaLiquida),
    topProdutos: [...porProduto.entries()]
      .map(([produto, v]) => {
        const dev = devolvidoPorProduto.get(produto) ?? { unidades: 0, valor: 0 };
        return {
          produto,
          unidadesBrutas: v.unidades,
          unidadesLiquidas: v.unidades - dev.unidades,
          receitaBruta: v.receita,
          receitaLiquida: v.receita - dev.valor,
        };
      })
      // 0 não conta como "comprado". Negativo fica visível de propósito (devolução > compra
      // naquele produto/loja/tamanho, normalmente troca feita em loja/registro diferente da
      // compra original) — sem clamp, a soma do card sempre bate com unidadesLiquidas do topo.
      .filter((p) => p.unidadesLiquidas !== 0)
      .sort((a, b) => b.receitaLiquida - a.receitaLiquida),
    topTamanhos: [...porTamanho.entries()]
      .map(([tamanho, unidades]) => ({ tamanho, unidades: unidades - (devolvidoPorTamanho.get(tamanho) ?? 0) }))
      .filter((t) => t.unidades !== 0)
      .sort((a, b) => b.unidades - a.unidades)
      .slice(0, 8),
    topLojas: [...porLoja.keys()]
      .map((loja) => ({ loja, pedidos: pedidosPorLoja.get(loja) ?? 0 }))
      .filter((l) => l.pedidos !== 0)
      .sort((a, b) => b.pedidos - a.pedidos),
    historicoMensal: [...porMes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, ...v })),
  };
}

// Aniversariantes de um mês específico (1-12), independente do ano de nascimento — pra
// campanha de aniversário. Segue os mesmos filtros da página (loja/marca/tabela de
// preço/vendedor/período) — só entra quem tem venda batendo com o filtro atual, mesma lista
// de clientes que já aparece em getTopClientes, só que sem o limite de 30 e sem ordenar por
// receita. Ordenado pelo dia do mês.
export async function getAniversariantesDoMes(filters: DashboardFilters, vendedor: string | null | undefined, month: number, canal: Canal = "todos") {
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(filters),
    clienteNome: { not: null },
    ...(vendedor ? { vendedor } : {}),
    ...(canal !== "todos" ? { AND: [canalWhere(canal)] } : {}),
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

export type SugestaoContato = {
  cliente: string;
  telefone: string | null;
  motivo: string;
  detalhe: string;
  produtoFavorito: string | null;
  atendente: 1 | 2;
};

// "Sugestões de Contato" — reformulado pelo Rodrigo em 2026-08-31 depois da 1ª versão: só B2C
// (isso aqui é atendimento de varejo, não relação com atacadista), mistura uma parte de CADA
// grupo (não deixa só VIP tomar a lista toda, como acontecia antes), mostra o produto favorito do
// cliente, muda todo dia (rotação, não sempre os mesmos), e divide entre as 2 pessoas do
// atendimento.
//
// 3 grupos, cada um contribuindo até POR_GRUPO_POR_DIA:
// 1) VIP esfriando (70-90 dias sem comprar — ainda dá tempo de reter antes de "em risco" de
//    verdade, limiar já usado em getClienteSegmentacao).
// 2) Recorrente esfriando (mesmo critério).
// 3) Aniversariante do mês.
//
// Rotação diária: cada grupo tem um pool (todo mundo elegível), e a cada dia pega uma "fatia"
// diferente do pool (round-robin pelo dia do ano) — em vez de sempre os mesmos K primeiros, dá
// pra cobrir o pool inteiro ao longo de vários dias e ainda assim mudar toda vez que alguém abre
// a tela no mesmo dia.
const POR_GRUPO_POR_DIA = 6;

function diaDoAno(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}

function fatiaDoDia<T>(pool: T[], porDia: number, seed: number): T[] {
  if (pool.length === 0) return [];
  const start = (seed * porDia) % pool.length;
  const out: T[] = [];
  for (let i = 0; i < Math.min(porDia, pool.length); i++) out.push(pool[(start + i) % pool.length]);
  return out;
}

const ESFRIANDO_DIAS_MIN = 70;
const ESFRIANDO_DIAS_MAX = 90;

export async function getSugestoesDeContato(filters: DashboardFilters): Promise<SugestaoContato[]> {
  const mesAtual = new Date().getUTCMonth() + 1;
  const [segmentacao, aniversariantes] = await Promise.all([
    getClienteSegmentacao(filters, "b2c"),
    getAniversariantesDoMes(filters, null, mesAtual, "b2c"),
  ]);

  // Só quem tem telefone no cadastro — sem isso não dá pra chamar no WhatsApp, não faz sentido
  // ocupar uma vaga do dia com alguém incontatável. Pedido do Rodrigo em 2026-08-31.
  const vipPool = segmentacao
    .filter((s) => s.segmento === "vip" && s.telefone && s.recenciaDias >= ESFRIANDO_DIAS_MIN && s.recenciaDias <= ESFRIANDO_DIAS_MAX)
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
  const recorrentePool = segmentacao
    .filter((s) => s.segmento === "recorrente" && s.telefone && s.recenciaDias >= ESFRIANDO_DIAS_MIN && s.recenciaDias <= ESFRIANDO_DIAS_MAX)
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
  // 3 grupos a mais, pedido do Rodrigo em 2026-08-31 — esses já são "frios" pela própria definição
  // do segmento (em_risco/inativo já passaram do limiar de recência, ocasional nunca teve um 2º
  // pedido), então não precisam da janela extra de "esfriando" que VIP/Recorrente usam.
  const emRiscoPool = segmentacao
    .filter((s) => s.segmento === "em_risco" && s.telefone)
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
  const ocasionalPool = segmentacao
    .filter((s) => s.segmento === "ocasional" && s.telefone)
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
  const inativoPool = segmentacao
    .filter((s) => s.segmento === "inativo" && s.telefone)
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
  const aniversarioPool = aniversariantes
    .filter((a) => a.telefone ?? a.celular)
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const seed = diaDoAno(new Date());
  const selecionados: Omit<SugestaoContato, "produtoFavorito" | "atendente">[] = [];
  for (const s of fatiaDoDia(vipPool, POR_GRUPO_POR_DIA, seed)) {
    selecionados.push({ cliente: s.cliente, telefone: s.telefone, motivo: "VIP esfriando", detalhe: `${s.recenciaDias} dias sem comprar` });
  }
  for (const s of fatiaDoDia(recorrentePool, POR_GRUPO_POR_DIA, seed)) {
    selecionados.push({ cliente: s.cliente, telefone: s.telefone, motivo: "Recorrente esfriando", detalhe: `${s.recenciaDias} dias sem comprar` });
  }
  for (const s of fatiaDoDia(emRiscoPool, POR_GRUPO_POR_DIA, seed)) {
    selecionados.push({ cliente: s.cliente, telefone: s.telefone, motivo: "Em risco", detalhe: `${s.recenciaDias} dias sem comprar` });
  }
  for (const s of fatiaDoDia(ocasionalPool, POR_GRUPO_POR_DIA, seed)) {
    selecionados.push({ cliente: s.cliente, telefone: s.telefone, motivo: "Comprou só 1 vez", detalhe: `há ${s.recenciaDias} dias` });
  }
  for (const s of fatiaDoDia(inativoPool, POR_GRUPO_POR_DIA, seed)) {
    selecionados.push({ cliente: s.cliente, telefone: s.telefone, motivo: "Inativo", detalhe: `${s.recenciaDias} dias sem comprar` });
  }
  for (const a of fatiaDoDia(aniversarioPool, POR_GRUPO_POR_DIA, seed)) {
    selecionados.push({
      cliente: a.nome,
      telefone: a.telefone ?? a.celular,
      motivo: "Aniversário",
      detalhe: `Dia ${a.dataNascimento.getUTCDate().toString().padStart(2, "0")}`,
    });
  }

  // Produto favorito — em lote (1 query pros clientes do dia, nunca 1 por linha).
  const produtosPorCliente = await getProdutosLiquidosPorClientes(filters, selecionados.map((s) => s.cliente));

  return selecionados.map((s, i) => ({
    ...s,
    produtoFavorito: produtosPorCliente.get(s.cliente.trim().toUpperCase())?.[0]?.produto ?? null,
    // Intercalado (1,2,1,2...) em vez de metade/metade em bloco — cada pessoa pega um pouco de
    // cada grupo, não "pessoa 1 = só VIP".
    atendente: (i % 2 === 0 ? 1 : 2) as 1 | 2,
  }));
}

export type FollowUpPosCompra = {
  cliente: string;
  telefone: string | null;
  produtos: string[];
  diasAtras: number;
};

// Follow-up pós-compra — pedido do Rodrigo em 2026-08-31: clientes que compraram há 7-10 dias,
// pra perguntar se gostou/conseguiu aproveitar o produto. Só B2C (mesma lógica da aba inteira).
// Não precisa de rotação artificial — a janela de 7-10 dias já muda sozinha todo dia conforme o
// tempo passa (quem cai nela hoje sai amanhã).
const FOLLOWUP_DIAS_MIN = 7;
const FOLLOWUP_DIAS_MAX = 10;

export async function getFollowUpPosCompra(filters: DashboardFilters): Promise<FollowUpPosCompra[]> {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - FOLLOWUP_DIAS_MAX * 86400000);
  const fim = new Date(hoje.getTime() - FOLLOWUP_DIAS_MIN * 86400000);
  const where: Prisma.SaleWhereInput = {
    ...saleWhere({ ...filters, from: inicio, to: fim }),
    clienteNome: { not: null },
    AND: [canalWhere("b2c")],
  };
  const rows = await prisma.sale.findMany({
    where,
    select: { clienteNome: true, saleDate: true, produto: true },
  });
  if (rows.length === 0) return [];

  const porCliente = new Map<string, { nome: string; produtos: Set<string>; data: Date }>();
  for (const r of rows) {
    const nome = r.clienteNome as string;
    const norm = nome.trim().toUpperCase();
    const cur = porCliente.get(norm) ?? { nome, produtos: new Set<string>(), data: r.saleDate };
    cur.produtos.add(r.produto);
    if (r.saleDate > cur.data) cur.data = r.saleDate;
    porCliente.set(norm, cur);
  }

  const nomes = [...porCliente.values()].map((c) => c.nome);
  const cadastros = await prisma.clienteCadastro.findMany({ where: { nome: { in: nomes } } });
  const cadastroByNome = new Map(cadastros.map((c) => [c.nome, c]));

  const now = new Date();
  return [...porCliente.values()]
    .map((c) => {
      const cad = cadastroByNome.get(c.nome);
      return {
        cliente: c.nome,
        telefone: cad?.telefone ?? cad?.celular ?? null,
        produtos: [...c.produtos],
        diasAtras: Math.floor((now.getTime() - c.data.getTime()) / 86400000),
      };
    })
    // Sem telefone não dá pra chamar no WhatsApp — mesmo critério de getSugestoesDeContato.
    .filter((f) => f.telefone !== null)
    .sort((a, b) => a.diasAtras - b.diasAtras);
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
//
// Também inclui os pedidos do site antigo (VendaHistoricaExterna, vnda 2021-2025) — pedido do
// Rodrigo em 2026-08-31: depois de só corrigir a data de 1ª compra "por baixo dos panos" ele
// quis que aparecesse de verdade aqui. Só entra em cliente/pedido/data/valor — sem grupo/produto
// (não existe pra essas linhas), então nunca polui Vendas por Grupo/Produto/Tamanho nem
// Estoque×Vendas, que continuam só com dado do DAPIC. Chaves normalizadas (trim+upper) em tudo
// agora — precisa pra casar nome do vnda com nome do DAPIC (que também tem variação de
// capitalização entre si).
export async function getClienteRetencaoVarejo(filters: DashboardFilters) {
  const baseWhere = saleWhere(filters);
  const norm = (n: string) => n.trim().toUpperCase();

  const [salesInPeriod, allTimeFirstSale, historicoInPeriod, historicoAllTimeFirst] = await Promise.all([
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
    // Site antigo não tem loja/marca/tabela/grupo — entra sempre, sem esses filtros.
    prisma.vendaHistoricaExterna.findMany({
      where: { saleDate: { gte: filters.from, lte: filters.to } },
      select: { clienteNome: true, saleDate: true, pedidoExterno: true },
    }),
    prisma.vendaHistoricaExterna.groupBy({
      by: ["clienteNome"],
      where: { saleDate: { lte: filters.to } },
      _min: { saleDate: true },
    }),
  ]);

  const firstPurchaseMonth = new Map<string, string>();
  function trackFirst(clienteNome: string, d: Date) {
    const k = norm(clienteNome);
    const m = d.toISOString().slice(0, 7);
    const cur = firstPurchaseMonth.get(k);
    if (!cur || m < cur) firstPurchaseMonth.set(k, m);
  }
  for (const r of allTimeFirstSale) if (r.clienteNome && r._min.saleDate) trackFirst(r.clienteNome, r._min.saleDate);
  for (const r of historicoAllTimeFirst) if (r._min.saleDate) trackFirst(r.clienteNome, r._min.saleDate);

  const pedidosPorCliente = new Map<string, Set<string>>();
  for (const s of salesInPeriod) {
    if (!s.clienteNome) continue;
    const k = norm(s.clienteNome);
    const set = pedidosPorCliente.get(k) ?? new Set<string>();
    set.add(String(s.dapicVendaId));
    pedidosPorCliente.set(k, set);
  }
  for (const h of historicoInPeriod) {
    const k = norm(h.clienteNome);
    const set = pedidosPorCliente.get(k) ?? new Set<string>();
    set.add(`vnda:${h.pedidoExterno}`);
    pedidosPorCliente.set(k, set);
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
    const set = monthClientMap.get(monthKey) ?? new Set<string>();
    set.add(norm(s.clienteNome));
    monthClientMap.set(monthKey, set);
  }
  for (const h of historicoInPeriod) {
    const monthKey = h.saleDate.toISOString().slice(0, 7);
    const set = monthClientMap.get(monthKey) ?? new Set<string>();
    set.add(norm(h.clienteNome));
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
export async function getDistribuicaoPedidos(filters: DashboardFilters, canal: Canal = "todos"): Promise<DistribuicaoPedidosItem[]> {
  const allTime: DashboardFilters = { ...filters, from: new Date(0), to: new Date() };
  const where: Prisma.SaleWhereInput = {
    ...saleWhere(allTime),
    clienteNome: { not: null },
    ...(canal !== "todos" ? { AND: [canalWhere(canal)] } : {}),
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
