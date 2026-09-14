import {
  getSessoesPorDia,
  getConversoes,
  getOrigemTrafego,
  getPaginasMaisVistas,
} from "@/lib/connectors/google-analytics";
import { getSessionUser } from "@/lib/auth";
import { requireTabAccess } from "@/lib/tabs";
import { defaultRecentRangeStr, type RawSearchParams } from "@/lib/filters";
import { StatTile } from "../stat-tile";
import { PieChart } from "../pie-chart";
import { IndicatorChart } from "../indicadores/indicator-chart";

function formatPct(v: number | null) {
  return v != null ? `${v.toFixed(1)}%` : "—";
}

export default async function AnalyticsSitePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "analytics-site");

  const rawParams = await searchParams;
  const defaults = defaultRecentRangeStr(30);
  const from = typeof rawParams.from === "string" && rawParams.from ? rawParams.from : defaults.from;
  const to = typeof rawParams.to === "string" && rawParams.to ? rawParams.to : defaults.to;

  let erro: string | null = null;
  let conversao: Awaited<ReturnType<typeof getConversoes>> | null = null;
  let sessoesPorDia: Awaited<ReturnType<typeof getSessoesPorDia>> = [];
  let origemTrafego: Awaited<ReturnType<typeof getOrigemTrafego>> = [];
  let paginasMaisVistas: Awaited<ReturnType<typeof getPaginasMaisVistas>> = [];

  try {
    const range = { startDate: from, endDate: to };
    [conversao, sessoesPorDia, origemTrafego, paginasMaisVistas] = await Promise.all([
      getConversoes(range),
      getSessoesPorDia(range),
      getOrigemTrafego(range),
      getPaginasMaisVistas(range, 20),
    ]);
  } catch (e) {
    erro = e instanceof Error ? e.message : "Erro desconhecido buscando dados do Google Analytics.";
  }

  const sessoesChartData = sessoesPorDia.map((s) => ({ day: s.data, sessoes: s.sessoes }));
  const totalSessoesOrigem = origemTrafego.reduce((sum, o) => sum + o.sessoes, 0);
  const origemPie = origemTrafego.map((o) => ({
    label: o.canal,
    value: o.sessoes,
    percentual: totalSessoesOrigem > 0 ? (o.sessoes / totalSessoesOrigem) * 100 : 0,
  }));

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Analytics do Site</h1>
      <p className="mb-4 text-sm text-[var(--text-muted)]">
        Tráfego do site vindo do Google Analytics 4 — fonte independente do DAPIC (não tem loja,
        marca ou coleção; é o site inteiro). Sessões, conversão, origem de tráfego e páginas mais
        vistas no período escolhido.
      </p>

      <form method="GET" action="/dashboard/analytics-site" className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="from">De</label>
          <input
            id="from"
            type="date"
            name="from"
            defaultValue={from}
            className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
            style={{ colorScheme: "light dark" }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="to">Até</label>
          <input
            id="to"
            type="date"
            name="to"
            defaultValue={to}
            className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
            style={{ colorScheme: "light dark" }}
          />
        </div>
        <button type="submit" className="rounded-md bg-[var(--series-1)] px-4 py-1.5 text-sm font-medium text-white">
          Aplicar
        </button>
      </form>

      {erro ? (
        <p className="rounded-lg border border-[var(--status-critical)] bg-[var(--surface-1)] p-4 text-sm text-[var(--text-secondary)]">
          Não consegui buscar dado do Google Analytics agora: {erro}
        </p>
      ) : (
        <>
          <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile label="Sessões" value={conversao!.sessoes.toLocaleString("pt-BR")} />
            <StatTile label="Usuários" value={conversao!.usuarios.toLocaleString("pt-BR")} />
            <StatTile label="Conversões" value={conversao!.conversoes.toLocaleString("pt-BR")} />
            <StatTile label="Taxa de conversão" value={formatPct(conversao!.taxaConversaoPct)} />
          </section>

          <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
            <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Sessões por dia</h2>
            <IndicatorChart
              data={sessoesChartData}
              format="number"
              granularity="day"
              series={[{ key: "sessoes", name: "Sessões", color: "var(--series-1)" }]}
            />
          </section>

          <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
            <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Origem de tráfego</h2>
            {origemPie.length > 0 ? (
              <PieChart data={origemPie} />
            ) : (
              <p className="text-sm text-[var(--text-muted)]">Sem dado no período.</p>
            )}
            <div className="mt-4 overflow-hidden rounded-lg border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                    <th className="px-4 py-2 font-medium">Canal</th>
                    <th className="px-4 py-2 font-medium text-right">Sessões</th>
                    <th className="px-4 py-2 font-medium text-right">% do total</th>
                    <th className="px-4 py-2 font-medium text-right">Conversões</th>
                    <th className="px-4 py-2 font-medium text-right">Taxa de conversão</th>
                  </tr>
                </thead>
                <tbody>
                  {origemTrafego.map((o) => (
                    <tr key={o.canal} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                      <td className="px-4 py-2 font-medium">{o.canal}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{o.sessoes.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                        {formatPct(totalSessoesOrigem > 0 ? (o.sessoes / totalSessoesOrigem) * 100 : null)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{o.conversoes.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                        {formatPct(o.sessoes > 0 ? (o.conversoes / o.sessoes) * 100 : null)}
                      </td>
                    </tr>
                  ))}
                  {origemTrafego.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-[var(--text-muted)]">Sem dado no período.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <h2 className="border-b border-[var(--gridline)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)]">
              Páginas mais vistas
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                  <th className="px-4 py-2 font-medium">#</th>
                  <th className="px-4 py-2 font-medium">Página</th>
                  <th className="px-4 py-2 font-medium text-right">Visualizações</th>
                </tr>
              </thead>
              <tbody>
                {paginasMaisVistas.map((p, i) => (
                  <tr key={p.caminho} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                    <td className="px-4 py-2 text-[var(--text-muted)]">{i + 1}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium text-[var(--text-primary)]">{p.titulo || p.caminho}</div>
                      <div className="text-xs text-[var(--text-muted)]">{p.caminho}</div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{p.visualizacoes.toLocaleString("pt-BR")}</td>
                  </tr>
                ))}
                {paginasMaisVistas.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-[var(--text-muted)]">Sem dado no período.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
