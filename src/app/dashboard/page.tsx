import { getSessionUser } from "@/lib/auth";
import {
  getKpiSummary,
  getSalesByDimension,
  getSalesByDay,
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
  const [kpi, salesByDimension, salesByDay, stores, marcas, tabelasPreco, syncs, newClients] = await Promise.all([
    getKpiSummary(filters),
    getSalesByDimension(filters, dimension),
    getSalesByDay(filters),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getLastSyncs(),
    getNewClientsCount(filters),
  ]);

  const showFinancials = canSeeFinancials(user.role);
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
          label="Clientes novos"
          value={newClients.toLocaleString("pt-BR")}
          trend={newClients > 0 ? "up" : undefined}
        />
      </section>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Vendas ao longo do período</h2>
        <SalesTrendChart data={salesByDay} showRevenue={showFinancials} />
      </section>

      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">
            Top {dimensionLabel.toLowerCase()} {showFinancials ? "por receita" : "por vendas"}
          </h2>
          <DimensionToggle basePath="/dashboard" searchParams={rawParams} current={dimension} />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
            <TopBarChart
              data={top10}
              valueKey={showFinancials ? "revenue" : "unitsSold"}
              showCurrency={showFinancials}
            />
          </div>
          <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
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
                  <tr key={g.key} className="border-b border-[var(--gridline)] last:border-0">
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
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Últimas sincronizações</h2>
        <ul className="flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
          {syncs.map((s) => (
            <li key={s.id} className="rounded-md border border-[var(--border)] px-3 py-1.5">
              {SOURCE_LABEL[s.source] ?? s.source}: {formatDateTime(s.startedAt)} —{" "}
              {s.status === "SUCCESS" ? `ok (${s.recordsSynced})` : "falhou"}
            </li>
          ))}
          {syncs.length === 0 && <li>Nenhuma sincronização registrada ainda.</li>}
        </ul>
      </section>
    </div>
  );
}
