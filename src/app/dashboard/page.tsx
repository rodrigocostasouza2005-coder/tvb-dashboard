import { getSessionUser } from "@/lib/auth";
import {
  getKpiSummary,
  getSalesByDimension,
  getSalesByDay,
  getSalesByDayPerStore,
  getStores,
  getMarcas,
  getTabelasPreco,
  getLastSyncs,
  getNewClientsCount,
} from "@/lib/metrics";
import {
  canSeeFinancials,
  getGrupoRestriction,
  getStoreRestriction,
  getMarcaRestriction,
  getTabelaPrecoRestriction,
} from "@/lib/permissions";
import { parseFilters, parseDimension, type RawSearchParams } from "@/lib/filters";
import { FilterBar } from "./filter-bar";
import { StatTile } from "./stat-tile";
import { DimensionToggle } from "./dimension-toggle";
import { SalesTrendChart } from "./sales-trend-chart";
import { TopBarChart } from "./top-bar-chart";
import { StoreCompareChart } from "./store-compare-chart";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTime(date: Date) {
  // Sem timeZone explícito, o servidor formata em UTC (não no fuso de Brasília) — mostrava
  // 2-3h a mais que o horário real.
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
}

const SOURCE_LABEL: Record<string, string> = {
  SALES: "Vendas",
  STOCK: "Estoque",
  RETURNS: "Devoluções",
  PRODUCTION: "Produção",
  GIFTS: "Brinde",
};

// Ordem fixa de exibição — todo runSync() grava as 5 fontes quase no mesmo instante, então
// ordenar por horário fica meio aleatório; essa ordem é sempre a mesma, mais fácil de escanear.
const SOURCE_ORDER = ["SALES", "STOCK", "RETURNS", "PRODUCTION", "GIFTS"];

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;

  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const rawParams = await searchParams;
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };
  const dimension = parseDimension(rawParams);
  const [kpi, salesByDimension, salesByDay, salesByDayPerStore, stores, marcas, tabelasPreco, syncs, newClients] =
    await Promise.all([
      getKpiSummary(filters),
      getSalesByDimension(filters, dimension),
      getSalesByDay(filters),
      getSalesByDayPerStore(filters),
      getStores(allowedStores),
      getMarcas(allowedMarcas),
      getTabelasPreco(allowedTabelasPreco),
      getLastSyncs(),
      getNewClientsCount(filters),
    ]);

  const showFinancials = canSeeFinancials(user);
  const top10 = salesByDimension.slice(0, 10);
  const dimensionLabel = dimension === "produto" ? "Produto" : dimension === "tamanho" ? "Tamanho" : "Grupo";

  return (
    <div>
      <FilterBar
        action="/dashboard"
        stores={stores}
        marcas={marcas}
        tabelasPreco={tabelasPreco}
        showTabelaPreco
        filters={filters}
      />

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Unidades vendidas" value={kpi.unitsSold.toLocaleString("pt-BR")} />
        {showFinancials && <StatTile label="Receita" value={formatBRL(kpi.revenue)} />}
        <StatTile label="Estoque atual" value={kpi.currentStock.toLocaleString("pt-BR")} />
        <StatTile
          label="Devoluções"
          value={kpi.unitsReturned.toLocaleString("pt-BR")}
          subValue={showFinancials ? formatBRL(kpi.valueReturned) : undefined}
          trend={kpi.unitsReturned > 0 ? "down" : undefined}
        />
        <StatTile
          label="Clientes novos"
          value={newClients.toLocaleString("pt-BR")}
          trend={newClients > 0 ? "up" : undefined}
        />
      </section>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Vendas ao longo do período</h2>
        <SalesTrendChart data={salesByDay} showRevenue={showFinancials} />
      </section>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Comparativo entre lojas</h2>
        <StoreCompareChart data={salesByDayPerStore.data} series={salesByDayPerStore.series} />
      </section>

      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">
            Top {dimensionLabel.toLowerCase()} {showFinancials ? "por receita" : "por vendas"}
          </h2>
          <DimensionToggle basePath="/dashboard" searchParams={rawParams} current={dimension} />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
            <TopBarChart
              data={top10}
              valueKey={showFinancials ? "revenue" : "unitsSold"}
              showCurrency={showFinancials}
            />
          </div>
          <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                  <th className="px-4 py-2 font-medium">{dimensionLabel}</th>
                  <th className="px-4 py-2 font-medium">Unidades</th>
                  {showFinancials && <th className="px-4 py-2 font-medium">Receita</th>}
                </tr>
              </thead>
              <tbody>
                {top10.map((g) => (
                  <tr key={g.key} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                    <td className="px-4 py-2 font-medium">{g.key}</td>
                    <td className="px-4 py-2 tabular-nums">{g.unitsSold.toLocaleString("pt-BR")}</td>
                    {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(g.revenue)}</td>}
                  </tr>
                ))}
                {top10.length === 0 && (
                  <tr>
                    <td colSpan={showFinancials ? 3 : 2} className="px-4 py-6 text-center text-[var(--text-muted)]">
                      Sem vendas no período/filtro selecionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
          Sincronizações — todas as fontes
        </h2>
        <ul className="flex flex-wrap gap-3 text-xs">
          {[...syncs]
            .sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source))
            .map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-1.5 text-[var(--text-muted)]"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: s.status === "SUCCESS" ? "var(--status-good)" : "var(--status-critical)" }}
                />
                <span className="font-medium text-[var(--text-primary)]">{SOURCE_LABEL[s.source] ?? s.source}</span>
                <span>{formatDateTime(s.startedAt)}</span>
                <span>{s.status === "SUCCESS" ? `ok (${s.recordsSynced})` : "falhou"}</span>
              </li>
            ))}
          {syncs.length === 0 && <li className="text-[var(--text-muted)]">Nenhuma sincronização registrada ainda.</li>}
        </ul>
      </section>
    </div>
  );
}
