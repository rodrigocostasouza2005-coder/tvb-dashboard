import { getSessionUser } from "@/lib/auth";
import { getMonthlySnapshotKpi, getMonthlySalesByStore, getSalesByDimension, getStores, type DashboardFilters, type Canal } from "@/lib/metrics";
import { canSeeFinancials, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction, getGrupoRestriction } from "@/lib/permissions";
import { parseFilters, brasiliaDayStart, brasiliaDayEnd, todayBrasiliaStr, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { StatTile } from "../stat-tile";
import { TrendChart } from "./trend-chart";

const DATA_START_MONTH = "2025-09";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function formatMonthLabel(monthStr: string) {
  const [year, m] = monthStr.split("-");
  return `${MONTH_NAMES[parseInt(m) - 1]} de ${year}`;
}

function formatMonthShort(monthStr: string) {
  const [year, m] = monthStr.split("-");
  return `${MONTH_NAMES[parseInt(m) - 1].slice(0, 3)}/${year.slice(2)}`;
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

function allMonthsSince(startMonth: string, endMonth: string) {
  const months: string[] = [];
  let cursor = startMonth;
  while (cursor <= endMonth) {
    months.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return months.reverse();
}

function trendPoint(change: number | null) {
  if (change === null) return undefined;
  return change >= 0 ? ("good" as const) : ("critical" as const);
}

function changeLabel(change: number | null, compareLabel: string) {
  if (change === null) return undefined;
  return `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}% vs ${compareLabel}`;
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
  const todayMonth = todayBrasiliaStr(new Date()).slice(0, 7);
  const month = typeof rawParams.month === "string" && /^\d{4}-\d{2}$/.test(rawParams.month)
    ? rawParams.month
    : todayMonth;
  const compareMonth = typeof rawParams.compare === "string" && /^\d{4}-\d{2}$/.test(rawParams.compare)
    ? rawParams.compare
    : shiftMonth(month, -1);
  const canal: Canal = rawParams.canal === "b2b" || rawParams.canal === "b2c" ? rawParams.canal : "todos";

  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);

  // Reaproveita a mesma lógica de seleção+permissão de loja do resto do dashboard (parâmetro
  // "store", grupos "id1|id2" expandidos, cruzado com o que o usuário pode ver) — só usa o
  // storeIds daqui, from/to são recalculados abaixo a partir do mês escolhido.
  const selectedStoreIds = parseFilters(rawParams, { allowedStoreIds: allowedStores }).storeIds ?? allowedStores;
  const storeOptions = await getStores(allowedStores);

  const baseRestriction = {
    storeIds: selectedStoreIds,
    marcas: allowedMarcas,
    tabelasPreco: allowedTabelasPreco,
    grupoIn,
  };

  const { from: curFrom, to: curTo } = monthRange(month);
  const { from: cmpFrom, to: cmpTo } = monthRange(compareMonth);
  const trendStartMonth = shiftMonth(month, -5);
  const { from: trendFrom } = monthRange(trendStartMonth);

  const curFilters: DashboardFilters = { ...baseRestriction, from: curFrom, to: curTo };
  const cmpFilters: DashboardFilters = { ...baseRestriction, from: cmpFrom, to: cmpTo };
  const trendFilters: DashboardFilters = { ...baseRestriction, from: trendFrom, to: curTo };

  const [curKpi, cmpKpi, trendRaw, topProdutos] = await Promise.all([
    getMonthlySnapshotKpi(curFilters, canal),
    getMonthlySnapshotKpi(cmpFilters, canal),
    getMonthlySalesByStore(trendFilters),
    getSalesByDimension(curFilters, "produto", canal),
  ]);

  const showFinancials = canSeeFinancials(user);

  const trendData = trendRaw.data.map((d) => ({
    month: d.month,
    revenue: trendRaw.series.reduce((s, k) => s + (d.revenue[k] ?? 0), 0),
  }));

  // Devolução é sempre B2C (confirmado pelo Rodrigo) — getMonthlySnapshotKpi já zera
  // valueReturned/unitsReturned quando canal="b2b", então líquida = bruta nesse caso
  // automaticamente, sem precisar de um caso especial aqui.
  const curRevenueLiquida = curKpi.revenueBruta - curKpi.valueReturned;
  const cmpRevenueLiquida = cmpKpi.revenueBruta - cmpKpi.valueReturned;
  const curUnitsLiquida = curKpi.unitsBruta - curKpi.unitsReturned;
  const cmpUnitsLiquida = cmpKpi.unitsBruta - cmpKpi.unitsReturned;
  // Ticket médio usa BRUTA, não líquida — devolução do mês pode ser de um pedido de mês
  // anterior (returnDate != saleDate do pedido original), então dividir líquida pelo número
  // de pedidos DESSE mês puxava o ticket pra baixo sem relação real com os pedidos contados.
  const curTicket = curKpi.orderCount > 0 ? curKpi.revenueBruta / curKpi.orderCount : 0;
  const cmpTicket = cmpKpi.orderCount > 0 ? cmpKpi.revenueBruta / cmpKpi.orderCount : 0;

  const revenueBrutaChange = pct(curKpi.revenueBruta, cmpKpi.revenueBruta);
  const revenueLiquidaChange = pct(curRevenueLiquida, cmpRevenueLiquida);
  const unitsBrutaChange = pct(curKpi.unitsBruta, cmpKpi.unitsBruta);
  const unitsLiquidaChange = pct(curUnitsLiquida, cmpUnitsLiquida);
  const ticketChange = pct(curTicket, cmpTicket);
  const ordersChange = pct(curKpi.orderCount, cmpKpi.orderCount);

  const compareLabel = formatMonthShort(compareMonth);

  const top5 = topProdutos.slice(0, 5);
  const maxRevenue = Math.max(1, ...top5.map((p) => p.revenue));

  const isCurrentMonth = month === todayMonth;
  const monthOptions = allMonthsSince(DATA_START_MONTH, todayMonth);

  // Toggle multi-select de loja (mesmo param "store" que o resto do dashboard usa) — clicar
  // adiciona/remove aquela loja da seleção, mantendo as outras já marcadas.
  const rawStoreSelection = Array.isArray(rawParams.store) ? rawParams.store : rawParams.store ? [rawParams.store] : [];

  // Preserva a seleção de loja em qualquer outro link (mês/comparar/canal) — só troca o
  // parâmetro pedido em overrides.
  const baseQuery = (overrides: Record<string, string>) => {
    const params = new URLSearchParams({ month, compare: compareMonth, canal, ...overrides });
    for (const v of rawStoreSelection) params.append("store", v);
    return `/dashboard/lamina-mensal?${params.toString()}`;
  };

  function storeToggleHref(optionId: string) {
    const next = rawStoreSelection.includes(optionId)
      ? rawStoreSelection.filter((v) => v !== optionId)
      : [...rawStoreSelection, optionId];
    const params = new URLSearchParams({ month, compare: compareMonth, canal });
    for (const v of next) params.append("store", v);
    return `/dashboard/lamina-mensal?${params.toString()}`;
  }
  const allStoresHref = (() => {
    const params = new URLSearchParams({ month, compare: compareMonth, canal });
    return `/dashboard/lamina-mensal?${params.toString()}`;
  })();

  return (
    <div className="mx-auto max-w-3xl">
      {/* Cabeçalho estilo lâmina */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">TVB Shorts — Lâmina Mensal</h1>
          <p className="text-sm text-[var(--text-secondary)]">{formatMonthLabel(month)}</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <a href={baseQuery({ month: shiftMonth(month, -1) })} className="rounded-md border border-[var(--border)] px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
            ← {formatMonthShort(shiftMonth(month, -1))}
          </a>
          {!isCurrentMonth && (
            <a href={baseQuery({ month: shiftMonth(month, 1) })} className="rounded-md border border-[var(--border)] px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
              {formatMonthShort(shiftMonth(month, 1))} →
            </a>
          )}
        </div>
      </div>

      {/* Controles: comparar com / canal */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <form method="get" action="/dashboard/lamina-mensal" className="flex items-end gap-2 text-sm">
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="canal" value={canal} />
          {rawStoreSelection.map((v) => (
            <input key={v} type="hidden" name="store" value={v} />
          ))}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--text-muted)]">Comparar com</span>
            <select
              name="compare"
              defaultValue={compareMonth}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-[var(--text-primary)]"
            >
              {monthOptions.filter((m) => m !== month).map((m) => (
                <option key={m} value={m}>{formatMonthLabel(m)}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
            Comparar
          </button>
        </form>

        <div className="flex gap-1">
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
      </div>

      {storeOptions.length > 1 && (
        <div className="mb-6 flex flex-wrap items-center gap-1.5 -mt-3">
          <span className="mr-1 text-xs text-[var(--text-muted)]">Loja:</span>
          <a
            href={allStoresHref}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              rawStoreSelection.length === 0
                ? "border-[var(--series-1)] bg-[var(--series-1)] text-white"
                : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
            }`}
          >
            Todas
          </a>
          {storeOptions.map((s) => (
            <a
              key={s.id}
              href={storeToggleHref(s.id)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                rawStoreSelection.includes(s.id)
                  ? "border-[var(--series-1)] bg-[var(--series-1)] text-white"
                  : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
              }`}
            >
              {s.name}
            </a>
          ))}
        </div>
      )}

      {/* KPIs principais */}
      {showFinancials && (
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            label="Receita bruta"
            value={formatBRL(curKpi.revenueBruta)}
            subValue={changeLabel(revenueBrutaChange, compareLabel)}
            status={trendPoint(revenueBrutaChange)}
          />
          <StatTile
            label="Receita líquida"
            value={formatBRL(curRevenueLiquida)}
            subValue={changeLabel(revenueLiquidaChange, compareLabel)}
            status={trendPoint(revenueLiquidaChange)}
          />
          <StatTile
            label="Ticket médio"
            value={formatBRL(curTicket)}
            subValue={changeLabel(ticketChange, compareLabel)}
            status={trendPoint(ticketChange)}
          />
        </div>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          label="Peças brutas"
          value={curKpi.unitsBruta.toLocaleString("pt-BR")}
          subValue={changeLabel(unitsBrutaChange, compareLabel)}
          status={trendPoint(unitsBrutaChange)}
        />
        <StatTile
          label="Peças líquidas"
          value={curUnitsLiquida.toLocaleString("pt-BR")}
          subValue={changeLabel(unitsLiquidaChange, compareLabel)}
          status={trendPoint(unitsLiquidaChange)}
        />
        <StatTile
          label="Pedidos"
          value={curKpi.orderCount.toLocaleString("pt-BR")}
          subValue={changeLabel(ordersChange, compareLabel)}
          status={trendPoint(ordersChange)}
        />
      </div>

      {canal === "b2b" && (
        <p className="mb-6 -mt-3 text-xs text-[var(--text-muted)]">
          * B2B não tem devolução (é sempre B2C) — líquida = bruta nessa visão.
        </p>
      )}

      {/* Tendência */}
      {showFinancials && trendData.length >= 2 && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Tendência de receita bruta (últimos 6 meses)</h2>
          <TrendChart data={trendData} />
        </section>
      )}

      {/* Top produtos */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Principais produtos faturados (receita bruta)</h2>
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
