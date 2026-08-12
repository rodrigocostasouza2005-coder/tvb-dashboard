import { getSessionUser } from "@/lib/auth";
import { getStockVsSales, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, parseDimension, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { DimensionToggle } from "../dimension-toggle";
import { statusFor } from "../status-filter";
import { MetricBarChart } from "../metric-bar-chart";

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "marketing");

  const rawParams = await searchParams;
  const dimension = parseDimension(rawParams);
  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  const [rows, stores, marcas, tabelasPreco] = await Promise.all([
    getStockVsSales(filters, dimension),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
  ]);

  const ranked = rows
    .map((r) => ({ ...r, pushScore: r.currentStock - r.unitsSold }))
    .sort((a, b) => b.pushScore - a.pushScore)
    .slice(0, 50);

  return (
    <div>
      <FilterBar
        action="/dashboard/marketing"
        stores={stores}
        marcas={marcas}
        tabelasPreco={tabelasPreco}
        showTabelaPreco
        filters={filters}
      />
      <DimensionToggle basePath="/dashboard/marketing" searchParams={rawParams} current={dimension} />

      <h2 className="mb-1 text-sm font-medium text-[var(--text-primary)]">
        Prioridade de exposição (estoque parado)
      </h2>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Ranking = estoque atual − vendido no período. Quanto maior, mais unidades sobrando precisam de
        empurrão. Sell-through vem do lado pra dar contexto — grupos grandes tendem a ter diferença alta
        só pelo tamanho, mesmo vendendo bem.
      </p>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Top estoque parado</h2>
        <MetricBarChart
          data={ranked.slice(0, 10).map((r) => ({ key: r.key, value: r.pushScore }))}
          color="var(--status-warning)"
        />
      </section>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">
                {dimension === "grupo" ? "Grupo" : dimension === "produto" ? "Produto" : "Tamanho"}
              </th>
              <th className="px-4 py-2 font-medium">Estoque − Vendas</th>
              <th className="px-4 py-2 font-medium">Estoque atual</th>
              <th className="px-4 py-2 font-medium">Vendido</th>
              <th className="px-4 py-2 font-medium">Sell-through</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => {
              const status = statusFor(r.sellThroughRate);
              return (
                <tr key={r.key} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium">
                    <span className="mr-2 text-[var(--text-muted)]">#{i + 1}</span>
                    {r.key}
                  </td>
                  <td className="px-4 py-2 tabular-nums font-medium">{r.pushScore.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 tabular-nums">{r.currentStock.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 tabular-nums">{r.unitsSold.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: status.color }} />
                      {r.sellThroughRate !== null ? `${r.sellThroughRate.toFixed(0)}%` : "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
            {ranked.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Sem dados para o período/filtro selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-8 text-xs text-[var(--text-muted)]">
        Outras métricas de marketing (origem de tráfego, campanhas, CAC etc) ainda não estão conectadas.
      </p>
    </div>
  );
}
