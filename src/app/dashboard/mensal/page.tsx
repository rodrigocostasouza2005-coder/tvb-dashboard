import { getSessionUser } from "@/lib/auth";
import { getMonthlySalesByStore, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { canSeeFinancials, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction, getGrupoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams, toDateInputValue } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { MonthlyChart } from "./monthly-chart";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatMonth(month: string) {
  const [year, m] = month.split("-");
  const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${months[parseInt(m) - 1]}/${year}`;
}

function pct(current: number, prev: number) {
  if (!prev) return null;
  return ((current - prev) / prev) * 100;
}

export default async function MensalPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "mensal");

  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const rawParams = await searchParams;

  // Default: últimos 12 meses completos (1º dia do mês, 12 meses atrás)
  const hasFrom = typeof rawParams.from === "string" && rawParams.from;
  const hasTo = typeof rawParams.to === "string" && rawParams.to;
  if (!hasFrom || !hasTo) {
    const now = new Date();
    const defaultTo = toDateInputValue(now);
    const d12 = new Date(now);
    d12.setMonth(d12.getMonth() - 11);
    d12.setDate(1);
    const defaultFrom = toDateInputValue(d12);
    rawParams.from = defaultFrom;
    rawParams.to = defaultTo;
  }

  const grupoIn = await getGrupoRestriction(user.role);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  const showRevenue = typeof rawParams.metric !== "string" || rawParams.metric !== "units";

  const [{ data, series }, stores, marcas, tabelasPreco] = await Promise.all([
    getMonthlySalesByStore(filters),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
  ]);
  const showFinancials = canSeeFinancials(user);

  // Totais por mês (para MoM e linha de total)
  const totals = data.map((d) => ({
    month: d.month,
    revenue: series.reduce((s, k) => s + (d.revenue[k] ?? 0), 0),
    units: series.reduce((s, k) => s + (d.units[k] ?? 0), 0),
  }));

  // Exibição em ordem decrescente na tabela (mês mais recente primeiro)
  const dataDesc = [...data].reverse();
  const totalsDesc = [...totals].reverse();

  return (
    <div>
      <CollapsibleFilters>
        <FilterBar
          action="/dashboard/mensal"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          showTabelaPreco
          filters={filters}
        />
      </CollapsibleFilters>

      {/* Toggle receita / unidades */}
      <div className="mb-4 flex gap-1">
        {[
          { label: "Receita bruta", value: "revenue" },
          { label: "Unidades brutas", value: "units" },
        ].map((opt) => {
          const active = opt.value === "revenue" ? showRevenue : !showRevenue;
          const href = `/dashboard/mensal?${new URLSearchParams({
            ...(typeof rawParams.from === "string" ? { from: rawParams.from } : {}),
            ...(typeof rawParams.to === "string" ? { to: rawParams.to } : {}),
            metric: opt.value,
          }).toString()}`;
          return (
            <a
              key={opt.value}
              href={href}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "border-[var(--series-1)] bg-[var(--series-1)] text-white"
                  : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
              }`}
            >
              {opt.label}
            </a>
          );
        })}
      </div>

      {/* Gráfico de barras empilhadas */}
      {data.length > 0 ? (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            {showRevenue ? "Receita bruta" : "Unidades brutas"} por mês e loja
          </h2>
          <MonthlyChart data={data} series={series} showRevenue={showRevenue && showFinancials} />
        </section>
      ) : (
        <p className="mb-6 text-sm text-[var(--text-muted)]">Sem dados no período selecionado.</p>
      )}

      {/* Tabela mensal */}
      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium whitespace-nowrap">Mês</th>
              {series.map((s) => (
                <th key={s} className="px-4 py-2 font-medium whitespace-nowrap">{s}</th>
              ))}
              <th className="px-4 py-2 font-medium whitespace-nowrap">Total</th>
              <th className="px-4 py-2 font-medium whitespace-nowrap">vs mês ant.</th>
            </tr>
          </thead>
          <tbody>
            {dataDesc.map((row, i) => {
              const total = totalsDesc[i];
              const prevTotal = totalsDesc[i + 1];
              const change = prevTotal
                ? pct(
                    showRevenue ? total.revenue : total.units,
                    showRevenue ? prevTotal.revenue : prevTotal.units
                  )
                : null;

              return (
                <tr key={row.month} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium whitespace-nowrap">{formatMonth(row.month)}</td>
                  {series.map((s) => {
                    const val = showRevenue ? (row.revenue[s] ?? 0) : (row.units[s] ?? 0);
                    return (
                      <td key={s} className="px-4 py-2 tabular-nums whitespace-nowrap">
                        {showRevenue && showFinancials
                          ? formatBRL(val)
                          : val.toLocaleString("pt-BR")}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2 tabular-nums font-medium whitespace-nowrap">
                    {showRevenue && showFinancials
                      ? formatBRL(showRevenue ? total.revenue : total.units)
                      : (showRevenue ? total.revenue : total.units).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-2 tabular-nums whitespace-nowrap">
                    {change === null ? (
                      <span className="text-[var(--text-muted)]">—</span>
                    ) : (
                      <span className={change >= 0 ? "text-[var(--status-ok)]" : "text-[var(--status-critical)]"}>
                        {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {data.length === 0 && (
              <tr>
                <td colSpan={series.length + 3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Sem vendas no período/filtro selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
