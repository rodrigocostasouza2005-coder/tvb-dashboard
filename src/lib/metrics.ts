import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export type Dimension = "grupo" | "produto" | "tamanho";

export type DashboardFilters = {
  storeIds?: string[];
  marca?: string;
  tabelaPreco?: string;
  from: Date;
  to: Date;
  // Restringe a grupos específicos — usado pra aplicar a regra de permissão do VENDEDOR
  // (só vê grupos prioritários) em qualquer dimensão, não só quando agrupando por grupo.
  grupoIn?: string[];
};

function saleWhere(filters: DashboardFilters): Prisma.SaleWhereInput {
  return {
    saleDate: { gte: filters.from, lte: filters.to },
    ...(filters.storeIds?.length ? { storeId: { in: filters.storeIds } } : {}),
    ...(filters.marca ? { marca: filters.marca } : {}),
    ...(filters.tabelaPreco ? { tabelaPreco: filters.tabelaPreco } : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
  };
}

function stockWhere(filters: Pick<DashboardFilters, "storeIds" | "grupoIn">): Prisma.StockSnapshotWhereInput {
  return {
    ...(filters.storeIds?.length ? { storeId: { in: filters.storeIds } } : {}),
    ...(filters.grupoIn ? { grupo: { in: filters.grupoIn } } : {}),
  };
}

export async function getKpiSummary(filters: DashboardFilters) {
  const [salesAgg, stockAgg] = await Promise.all([
    prisma.sale.aggregate({
      where: saleWhere(filters),
      _sum: { quantidade: true, valorTotalLiquido: true, valorCustoTotal: true },
    }),
    prisma.stockSnapshot.aggregate({
      where: stockWhere(filters),
      _sum: { quantidadeDisponivel: true },
    }),
  ]);

  return {
    unitsSold: salesAgg._sum.quantidade ?? 0,
    revenue: salesAgg._sum.valorTotalLiquido ?? 0,
    cost: salesAgg._sum.valorCustoTotal ?? 0,
    currentStock: stockAgg._sum.quantidadeDisponivel ?? 0,
  };
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

// Pega o snapshot mais recente por loja+produto (evita somar duplicado se já tivermos
// vários syncs no histórico).
async function latestStockSnapshots(filters: Pick<DashboardFilters, "storeIds" | "grupoIn">) {
  const rows = await prisma.stockSnapshot.findMany({
    where: stockWhere(filters),
    orderBy: { syncedAt: "desc" },
    select: {
      storeId: true,
      cod: true,
      grupo: true,
      produto: true,
      tamanho: true,
      quantidadeDisponivel: true,
      estoqueMinimo: true,
      valorCusto: true,
    },
  });
  const seen = new Set<string>();
  const latest: typeof rows = [];
  for (const row of rows) {
    const key = `${row.storeId}::${row.cod}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(row);
  }
  return latest;
}

export async function getStockVsSales(filters: DashboardFilters, dimension: Dimension = "grupo") {
  const [sales, stock] = await Promise.all([
    getSalesByDimension(filters, dimension),
    latestStockSnapshots(filters),
  ]);

  const stockByKey = new Map<string, number>();
  for (const s of stock) {
    const key = dimensionKey(dimension, s);
    stockByKey.set(key, (stockByKey.get(key) ?? 0) + s.quantidadeDisponivel);
  }

  const keys = new Set([...sales.map((s) => s.key), ...stockByKey.keys()]);

  return [...keys]
    .map((key) => {
      const sale = sales.find((s) => s.key === key);
      const unitsSold = sale?.unitsSold ?? 0;
      const revenue = sale?.revenue ?? 0;
      const currentStock = stockByKey.get(key) ?? 0;
      const sellThroughRate =
        unitsSold + currentStock > 0 ? (unitsSold / (unitsSold + currentStock)) * 100 : null;
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

export async function getReplenishment(filters: Pick<DashboardFilters, "storeIds" | "grupoIn">) {
  const stock = await latestStockSnapshots(filters);
  const storeIds = [...new Set(stock.map((s) => s.storeId))];
  const stores = await prisma.store.findMany({ where: { id: { in: storeIds } } });
  const storeName = new Map(stores.map((s) => [s.id, s.name]));

  return stock
    .filter((s) => s.estoqueMinimo != null && s.quantidadeDisponivel < s.estoqueMinimo)
    .map((s) => ({
      storeId: s.storeId,
      storeName: storeName.get(s.storeId) ?? s.storeId,
      grupo: s.grupo,
      tamanho: s.tamanho,
      quantidadeDisponivel: s.quantidadeDisponivel,
      estoqueMinimo: s.estoqueMinimo as number,
      falta: (s.estoqueMinimo as number) - s.quantidadeDisponivel,
    }))
    .sort((a, b) => b.falta - a.falta);
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

export async function getStores() {
  return prisma.store.findMany({ where: { sellsProducts: true }, orderBy: { name: "asc" } });
}

// Todos os armazenadores, incluindo os que não são loja de venda (Defeito, Bonificação,
// Lixeira, Marketing/Produção) — usado no filtro da aba Estoque Atual.
export async function getAllStores() {
  return prisma.store.findMany({ orderBy: { name: "asc" } });
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

export async function getMarcas() {
  const rows = await prisma.sale.findMany({
    distinct: ["marca"],
    select: { marca: true },
    where: { marca: { not: null } },
  });
  return rows.map((r) => r.marca as string).sort();
}

export async function getTabelasPreco() {
  const rows = await prisma.sale.findMany({
    distinct: ["tabelaPreco"],
    select: { tabelaPreco: true },
    where: { tabelaPreco: { not: null } },
  });
  return rows.map((r) => r.tabelaPreco as string).sort();
}

export async function getLastSyncs() {
  return prisma.syncLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 4,
  });
}
