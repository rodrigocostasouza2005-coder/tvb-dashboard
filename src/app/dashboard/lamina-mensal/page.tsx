import { getSessionUser } from "@/lib/auth";
import { getKpiSummary, getMonthlySalesByStore, getSalesByDimension, type DashboardFilters } from "@/lib/metrics";
import { canSeeFinancials, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction, getGrupoRestriction } from "@/lib/permissions";
import { brasiliaDayStart, brasiliaDayEnd, todayBrasiliaStr, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { StatTile } from "../stat-tile";
import { TrendChart } from "./trend-chart";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatMonthLabel(monthStr: string) {
  const [year, m] = monthStr.split("-");
  const months = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  return `${months[parseInt(m) - 1]} de ${year}`;
}

function pct(current: number, prev: number) {
  if (!prev) return null;
  return ((current - prev) / prev) * 100;
}

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

export default async function LaminaMensalPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "lamina-mensal");

  const rawParams = await searchParams;
  const month = typeof rawParams.month === "string" && /^\d{4}-\d{2}$/.test(rawParams.month)
    ? rawParams.month
    : todayBrasiliaStr(new Date()).slice(0, 7);

  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);

  const baseRestriction = {
    storeIds: allowedStores,
    marcas: allowedMarcas,
    tabelasPreco: allowedTabelasPreco,
    grupoIn,
  };

  const { from: curFrom, to: curTo } = monthRange(month);
  const prevMonth = shiftMonth(month, -1);
  const { from: prevFrom, to: prevTo } = monthRange(prevMonth);
  const trendStartMonth = shiftMonth(month, -5);
  const { from: trendFrom } = monthRange(trendStartMonth);

  const curFilters: DashboardFilters = { ...baseRestriction, from: curFrom, to: curTo };
  const prevFilters: DashboardFilters = { ...baseRestriction, from: prevFrom, to: prevTo };
  const trendFilters: DashboardFilters = { ...baseRestriction, from: trendFrom, to: curTo };

  const [curKpi, prevKpi, trendRaw, topProdutos] = await Promise.all([
    getKpiSummary(curFilters),
    getKpiSummary(prevFilters),
    getMonthlySalesByStore(trendFilters),
    getSalesByDimension(curFilters, "produto"),
  ]);

  const showFinancials = canSeeFinancials(user);

  const trendData = trendRaw.data.map((d) => ({
    month: d.month,
    revenue: trendRaw.series.reduce((s, k) => s + (d.revenue[k] ?? 0), 0),
  }));

  const revenueChange = pct(curKpi.revenue, prevKpi.revenue);
  const unitsChange = pct(curKpi.unitsSold, prevKpi.unitsSold);
  const curTicket = curKpi.unitsSold > 0 ? curKpi.revenue / curKpi.unitsSold : 0;
  const prevTicket = prevKpi.unitsSold > 0 ? prevKpi.revenue / prevKpi.unitsSold : 0;
  const ticketChange = pct(curTicket, prevTicket);
  const devolucaoRate = curKpi.revenue > 0 ? (curKpi.valueReturned / curKpi.revenue) * 100 : 0;

  const top5 = topProdutos.slice(0, 5);
  const maxRevenue = Math.max(1, ...top5.map((p) => p.revenue));

  const isCurrentMonth = month === todayBrasiliaStr(new Date()).slice(0, 7);

  return (
    <div className="mx-auto max-w-3xl">
      {/* Cabeçalho estilo lâmina */}
      <div className="mb-6 flex items-center justify-between border-b border-[var(--border)] pb-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">TVB Shorts — Lâmina Mensal</h1>
          <p className="text-sm text-[var(--text-secondary)]">{formatMonthLabel(month)}</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <a
            href={`/dashboard/lamina-mensal?month=${shiftMonth(month, -1)}`}
            className="rounded-md border border-[var(--border)] px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
          >
            ← {formatMonthLabel(prevMonth).split(" de ")[0]}
          </a>
          {!isCurrentMonth && (
            <a
              href={`/dashboard/lamina-mensal?month=${shiftMonth(month, 1)}`}
              className="rounded-md border border-[var(--border)] px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
            >
              {formatMonthLabel(shiftMonth(month, 1)).split(" de ")[0]} →
            </a>
          )}
        </div>
      </div>

      {/* KPIs principais */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {showFinancials && (
          <StatTile
            label="Receita do mês"
            value={formatBRL(curKpi.revenue)}
            subValue={revenueChange !== null ? `${revenueChange >= 0 ? "▲" : "▼"} ${Math.abs(revenueChange).toFixed(1)}% vs mês ant.` : undefined}
            status={revenueChange !== null ? (revenueChange >= 0 ? "good" : "critical") : undefined}
          />
        )}
        <StatTile
          label="Unidades vendidas"
          value={curKpi.unitsSold.toLocaleString("pt-BR")}
          subValue={unitsChange !== null ? `${unitsChange >= 0 ? "▲" : "▼"} ${Math.abs(unitsChange).toFixed(1)}% vs mês ant.` : undefined}
          status={unitsChange !== null ? (unitsChange >= 0 ? "good" : "critical") : undefined}
        />
        {showFinancials && (
          <StatTile
            label="Ticket médio"
            value={formatBRL(curTicket)}
            subValue={ticketChange !== null ? `${ticketChange >= 0 ? "▲" : "▼"} ${Math.abs(ticketChange).toFixed(1)}% vs mês ant.` : undefined}
            status={ticketChange !== null ? (ticketChange >= 0 ? "good" : "critical") : undefined}
          />
        )}
        {showFinancials && (
          <StatTile
            label="Devoluções"
            value={`${devolucaoRate.toFixed(1)}%`}
            subValue="do faturamento do mês"
            status={devolucaoRate <= 5 ? "good" : devolucaoRate <= 10 ? "warning" : "critical"}
          />
        )}
      </div>

      {/* Tendência */}
      {showFinancials && trendData.length >= 2 && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Tendência (últimos 6 meses)</h2>
          <TrendChart data={trendData} />
        </section>
      )}

      {/* Top produtos */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Top 5 produtos do mês</h2>
        {top5.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Sem vendas no período.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {top5.map((p, i) => (
              <li key={p.key} className="flex items-center gap-3">
                <span className="w-4 text-xs font-medium text-[var(--text-muted)]">{i + 1}</span>
                <span className="flex-1 truncate text-sm text-[var(--text-primary)]">{p.key}</span>
                <div className="h-2 flex-1 max-w-[120px] overflow-hidden rounded-full bg-[var(--page-plane)]">
                  <div
                    className="h-full rounded-full bg-[var(--series-1)]"
                    style={{ width: `${(p.revenue / maxRevenue) * 100}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-[var(--text-secondary)]">
                  {showFinancials ? formatBRL(p.revenue) : `${p.unitsSold.toLocaleString("pt-BR")} un.`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
        TVB Radar — gerado em {new Date().toLocaleDateString("pt-BR")}
      </p>
    </div>
  );
}
