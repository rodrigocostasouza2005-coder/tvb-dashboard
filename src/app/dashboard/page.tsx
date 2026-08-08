import { getSessionUser } from "@/lib/auth";
import { getKpiSummary, getSalesByDimension, getStores, getMarcas, getTabelasPreco, getLastSyncs } from "@/lib/metrics";
import { canSeeFinancials, getGrupoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { FilterBar } from "./filter-bar";
import { StatTile } from "./stat-tile";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTime(date: Date) {
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

const SOURCE_LABEL: Record<string, string> = {
  SALES: "Vendas",
  STOCK: "Estoque",
  RETURNS: "Devoluções",
  PRODUCTION: "Produção",
};

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;

  const grupoIn = await getGrupoRestriction(user.role);
  const filters = { ...parseFilters(await searchParams), grupoIn };
  const [kpi, salesByGroup, stores, marcas, tabelasPreco, syncs] = await Promise.all([
    getKpiSummary(filters),
    getSalesByDimension(filters, "grupo"),
    getStores(),
    getMarcas(),
    getTabelasPreco(),
    getLastSyncs(),
  ]);

  const showFinancials = canSeeFinancials(user.role);
  const top5 = salesByGroup.slice(0, 5);

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
        {showFinancials && (
          <StatTile
            label="Margem"
            value={
              kpi.revenue > 0 ? `${(((kpi.revenue - kpi.cost) / kpi.revenue) * 100).toFixed(0)}%` : "—"
            }
          />
        )}
        <StatTile label="Estoque atual" value={kpi.currentStock.toLocaleString("pt-BR")} />
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
          Top grupos de produto {showFinancials ? "por receita" : "por vendas"}
        </h2>
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Grupo</th>
                <th className="px-4 py-2 font-medium">Unidades</th>
                {showFinancials && <th className="px-4 py-2 font-medium">Receita</th>}
              </tr>
            </thead>
            <tbody>
              {top5.map((g) => (
                <tr key={g.key} className="border-b border-[var(--gridline)] last:border-0">
                  <td className="px-4 py-2 font-medium">{g.key}</td>
                  <td className="px-4 py-2 tabular-nums">{g.unitsSold.toLocaleString("pt-BR")}</td>
                  {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(g.revenue)}</td>}
                </tr>
              ))}
              {top5.length === 0 && (
                <tr>
                  <td colSpan={showFinancials ? 3 : 2} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Sem vendas no período/filtro selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
