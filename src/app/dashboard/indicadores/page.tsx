import { getSessionUser } from "@/lib/auth";
import { getMonthlySnapshotKpi, getStores, getMarcas, getTabelasPreco, type DashboardFilters, type Canal } from "@/lib/metrics";
import { canSeeFinancials, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction, getGrupoRestriction } from "@/lib/permissions";
import { parseFilters, brasiliaDayStart, brasiliaDayEnd, todayBrasiliaStr, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { IndicatorChart } from "./indicator-chart";

const DATA_START_MONTH = "2025-09";

function monthRange(monthStr: string) {
  const [year, m] = monthStr.split("-").map(Number);
  const from = brasiliaDayStart(`${monthStr}-01`);
  const lastDay = new Date(year, m, 0).getDate();
  const todayStr = todayBrasiliaStr(new Date());
  const isCurrentMonth = todayStr.slice(0, 7) === monthStr;
  const to = isCurrentMonth ? brasiliaDayEnd(todayStr) : brasiliaDayEnd(`${monthStr}-${String(lastDay).padStart(2, "0")}`);
  return { from, to };
}

function shiftMonth(monthStr: string, delta: number) {
  const [year, m] = monthStr.split("-").map(Number);
  const d = new Date(year, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function allMonthsSince(startMonth: string, endMonth: string) {
  const months: string[] = [];
  let cursor = startMonth;
  while (cursor <= endMonth) {
    months.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return months;
}

export default async function IndicadoresPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "indicadores");

  const rawParams = await searchParams;
  const todayMonth = todayBrasiliaStr(new Date()).slice(0, 7);
  const canal: Canal = rawParams.canal === "b2b" || rawParams.canal === "b2c" ? rawParams.canal : "todos";

  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);

  const selectedStoreIds = parseFilters(rawParams, { allowedStoreIds: allowedStores }).storeIds ?? allowedStores;
  const baseRestriction = {
    storeIds: selectedStoreIds,
    marcas: allowedMarcas,
    tabelasPreco: allowedTabelasPreco,
    grupoIn,
  };

  const showFinancials = canSeeFinancials(user);

  const months = allMonthsSince(DATA_START_MONTH, todayMonth);
  const [kpisPerMonth, stores, marcas, tabelasPreco] = await Promise.all([
    Promise.all(
      months.map(async (month) => {
        const { from, to } = monthRange(month);
        const kpi = await getMonthlySnapshotKpi({ ...baseRestriction, from, to }, canal);
        return { month, ...kpi };
      })
    ),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
  ]);

  const chartData = kpisPerMonth.map((k) => {
    const revenueLiquida = k.revenueBruta - k.valueReturned;
    const unitsLiquida = k.unitsBruta - k.unitsReturned;
    return {
      month: k.month,
      revenueBruta: k.revenueBruta,
      revenueLiquida,
      unitsBruta: k.unitsBruta,
      unitsLiquida,
      ticketMedio: k.orderCount > 0 ? revenueLiquida / k.orderCount : 0,
      devolucaoPct: k.revenueBruta > 0 ? (k.valueReturned / k.revenueBruta) * 100 : 0,
    };
  });

  const rawStoreSelection = Array.isArray(rawParams.store) ? rawParams.store : rawParams.store ? [rawParams.store] : [];
  const baseQuery = (overrides: Record<string, string>) => {
    const params = new URLSearchParams({ canal, ...overrides });
    for (const v of rawStoreSelection) params.append("store", v);
    return `/dashboard/indicadores?${params.toString()}`;
  };

  return (
    <div>
      <CollapsibleFilters>
        <FilterBar
          action="/dashboard/indicadores"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          showTabelaPreco
          showDate={false}
          filters={{ ...baseRestriction, from: brasiliaDayStart(DATA_START_MONTH + "-01"), to: new Date() }}
        />
      </CollapsibleFilters>

      <div className="mb-6 flex gap-1">
        {([
          { value: "todos", label: "Todos" },
          { value: "b2b", label: "B2B (atacado)" },
          { value: "b2c", label: "B2C (varejo)" },
        ] as const).map((opt) => (
          <a
            key={opt.value}
            href={baseQuery({ canal: opt.value })}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              canal === opt.value
                ? "border-[var(--series-1)] bg-[var(--series-1)] text-white"
                : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
            }`}
          >
            {opt.label}
          </a>
        ))}
      </div>

      {showFinancials && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Receita por mês</h2>
          <IndicatorChart
            data={chartData}
            format="currency"
            series={[
              { key: "revenueBruta", name: "Bruta", color: "var(--series-1)" },
              { key: "revenueLiquida", name: "Líquida", color: "var(--series-2)" },
            ]}
          />
        </section>
      )}

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Unidades vendidas por mês</h2>
        <IndicatorChart
          data={chartData}
          format="number"
          series={[
            { key: "unitsBruta", name: "Brutas", color: "var(--series-1)" },
            { key: "unitsLiquida", name: "Líquidas", color: "var(--series-2)" },
          ]}
        />
      </section>

      {showFinancials && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Ticket médio por mês</h2>
          <IndicatorChart
            data={chartData}
            format="currency"
            series={[{ key: "ticketMedio", name: "Ticket médio", color: "var(--series-1)" }]}
          />
        </section>
      )}

      {showFinancials && (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Devoluções (% da receita) por mês</h2>
          <IndicatorChart
            data={chartData}
            format="percent"
            series={[{ key: "devolucaoPct", name: "Devoluções", color: "var(--status-critical)" }]}
          />
        </section>
      )}
    </div>
  );
}
