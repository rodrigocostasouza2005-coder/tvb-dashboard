import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

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
    ...(filters.storeIds?.length ? { storeId: { in: filters.storeIds } } : {}),
    ...(filters.marcas?.length ? { marca: { in: filters.marcas } } : {}),
    ...(filters.tabelasPreco?.length ? { tabelaPreco: { in: filters.tabelasPreco } } : {}),
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
      colecao: true,
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
        (!cdStore || s.storeId !== cdStore.id)
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
    .sort((a, b) => b.falta - a.falta);
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
export async function getStockAging(filters: Pick<DashboardFilters, "storeIds" | "grupoIn">) {
  const stock = (await latestStockSnapshots(filters)).filter((s) => s.quantidadeDisponivel > 0);
  if (stock.length === 0) return [];

  const storeIds = [...new Set(stock.map((s) => s.storeId))];
  const cods = [...new Set(stock.map((s) => s.cod))];

  const [saleAgg, stores] = await Promise.all([
    prisma.sale.groupBy({
      by: ["storeId", "cod"],
      where: { storeId: { in: storeIds }, cod: { in: cods } },
      _min: { saleDate: true },
      _max: { saleDate: true },
      _sum: { quantidade: true },
    }),
    prisma.store.findMany({ where: { id: { in: storeIds } } }),
  ]);

  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const saleByKey = new Map(saleAgg.map((s) => [`${s.storeId}::${s.cod}`, s]));

  const today = new Date();
  const daysSince = (d: Date | null | undefined) =>
    d ? Math.floor((today.getTime() - d.getTime()) / 86_400_000) : null;

  return stock
    .map((s) => {
      const sale = saleByKey.get(`${s.storeId}::${s.cod}`);
      const primeiraVenda = sale?._min.saleDate ?? null;
      const ultimaVenda = sale?._max.saleDate ?? null;
      const totalVendido = sale?._sum.quantidade ?? 0;
      const sellThroughRate =
        totalVendido + s.quantidadeDisponivel > 0
          ? (totalVendido / (totalVendido + s.quantidadeDisponivel)) * 100
          : null;
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

export async function getStores(): Promise<StoreFilterOption[]> {
  const stores = await prisma.store.findMany({ where: { sellsProducts: true }, orderBy: { name: "asc" } });
  return groupStoresForFilter(stores);
}

// Todos os armazenadores, incluindo os que não são loja de venda (Defeito, Bonificação,
// Lixeira, Marketing/Produção) — usado no filtro da aba Estoque Atual.
export async function getAllStores(): Promise<StoreFilterOption[]> {
  const stores = await prisma.store.findMany({ orderBy: { name: "asc" } });
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
export async function getEstoquePorArmazenador(filters: Pick<DashboardFilters, "grupoIn"> = {}) {
  const stock = await latestStockSnapshots({ grupoIn: filters.grupoIn });
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
  const rows = await prisma.stockSnapshot.findMany({ distinct: ["grupo"], select: { grupo: true } });
  return rows.map((r) => r.grupo).sort();
}

export async function getDistinctTamanhos() {
  const rows = await prisma.stockSnapshot.findMany({
    distinct: ["tamanho"],
    select: { tamanho: true },
    where: { tamanho: { not: null } },
  });
  return rows.map((r) => r.tamanho as string).sort();
}

export async function getMinimumRules() {
  return prisma.stockMinimumRule.findMany({
    include: { store: true },
    orderBy: [{ storeId: "asc" }, { grupo: "asc" }, { tamanho: "asc" }],
  });
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
