import { getSessionUser } from "@/lib/auth";
import { getStockVsSales, getStores, getMarcas, getTabelasPreco, getDistinctColecoes } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, parseDimension, toDateInputValue, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import {
  getSessoesPorDia,
  getConversoes,
  getOrigemTrafego,
  getPaginasMaisVistas,
  type Ga4Sessao,
  type Ga4Conversao,
  type Ga4OrigemTrafego,
  type Ga4PaginaMaisVista,
} from "@/lib/connectors/google-analytics";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { DimensionToggle } from "../dimension-toggle";
import { StatTile } from "../stat-tile";
import { statusFor } from "../status-filter";
import { MetricBarChart } from "../metric-bar-chart";
import { IndicatorChart } from "../indicadores/indicator-chart";

function formatPct(v: number | null) {
  return v != null ? `${v.toFixed(1)}%` : "—";
}

// GA4 é uma fonte à parte do DAPIC (tráfego do site, não venda/estoque por loja) — se a conta de
// serviço ainda não tiver sido configurada, ou o Google estiver fora do ar, a aba inteira de
// Marketing não pode cair por causa disso. Ver connectors/google-analytics.ts.
async function getGa4Seguro(from: string, to: string): Promise<{
  conversao: Ga4Conversao;
  sessoesPorDia: Ga4Sessao[];
  origemTrafego: Ga4OrigemTrafego[];
  paginasMaisVistas: Ga4PaginaMaisVista[];
} | null> {
  try {
    const range = { startDate: from, endDate: to };
    const [conversao, sessoesPorDia, origemTrafego, paginasMaisVistas] = await Promise.all([
      getConversoes(range),
      getSessoesPorDia(range),
      getOrigemTrafego(range),
      getPaginasMaisVistas(range, 10),
    ]);
    return { conversao, sessoesPorDia, origemTrafego, paginasMaisVistas };
  } catch (e) {
    console.error("[marketing] GA4 falhou:", e instanceof Error ? e.message : e);
    return null;
  }
}

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "marketing");

  const rawParams = await searchParams;
  const filtrosOpen = rawParams.filtros === "1";
  const dimension = parseDimension(rawParams);
  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  const [rows, stores, marcas, tabelasPreco, colecoes, ga4] = await Promise.all([
    getStockVsSales(filters, dimension),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getDistinctColecoes(),
    getGa4Seguro(toDateInputValue(filters.from), toDateInputValue(filters.to)),
  ]);

  const ranked = rows
    .map((r) => ({ ...r, pushScore: r.currentStock - r.unitsSold }))
    .sort((a, b) => b.pushScore - a.pushScore)
    .slice(0, 50);

  const sessoesChartData = ga4?.sessoesPorDia.map((s) => ({ day: s.data, sessoes: s.sessoes })) ?? [];

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/marketing"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          colecoes={colecoes}
          showTabelaPreco
          filters={filters}
        />
      </CollapsibleFilters>
      <h2 className="mb-3 text-base font-semibold">Site (Google Analytics)</h2>
      {ga4 ? (
        <>
          <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatTile label="Sessões no período" value={ga4.conversao.sessoes.toLocaleString("pt-BR")} />
            <StatTile label="Conversões" value={ga4.conversao.conversoes.toLocaleString("pt-BR")} />
            <StatTile label="Taxa de conversão" value={formatPct(ga4.conversao.taxaConversaoPct)} />
          </section>

          <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
            <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Sessões por dia</h3>
            <IndicatorChart
              data={sessoesChartData}
              format="number"
              granularity="day"
              series={[{ key: "sessoes", name: "Sessões", color: "var(--series-1)" }]}
            />
          </section>

          <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <h3 className="border-b border-[var(--gridline)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)]">Origem de tráfego</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                    <th className="px-4 py-2 font-medium">Canal</th>
                    <th className="px-4 py-2 font-medium text-right">Sessões</th>
                    <th className="px-4 py-2 font-medium text-right">Conversões</th>
                  </tr>
                </thead>
                <tbody>
                  {ga4.origemTrafego.map((o) => (
                    <tr key={o.canal} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                      <td className="px-4 py-2 font-medium">{o.canal}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{o.sessoes.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{o.conversoes.toLocaleString("pt-BR")}</td>
                    </tr>
                  ))}
                  {ga4.origemTrafego.length === 0 && (
                    <tr><td colSpan={3} className="px-4 py-6 text-center text-[var(--text-muted)]">Sem dado no período.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <h3 className="border-b border-[var(--gridline)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)]">Páginas mais vistas</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                    <th className="px-4 py-2 font-medium">Página</th>
                    <th className="px-4 py-2 font-medium text-right">Visualizações</th>
                  </tr>
                </thead>
                <tbody>
                  {ga4.paginasMaisVistas.map((p) => (
                    <tr key={p.caminho} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                      <td className="px-4 py-2">
                        <div className="font-medium text-[var(--text-primary)]">{p.titulo || p.caminho}</div>
                        <div className="text-xs text-[var(--text-muted)]">{p.caminho}</div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{p.visualizacoes.toLocaleString("pt-BR")}</td>
                    </tr>
                  ))}
                  {ga4.paginasMaisVistas.length === 0 && (
                    <tr><td colSpan={2} className="px-4 py-6 text-center text-[var(--text-muted)]">Sem dado no período.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <p className="mb-6 text-xs text-[var(--text-muted)]">
          Google Analytics ainda não conectado (ou a conexão falhou) — sem dado de site pra mostrar aqui.
        </p>
      )}

      <DimensionToggle basePath="/dashboard/marketing" searchParams={rawParams} current={dimension} />

      <h2 className="mb-1 text-sm font-medium text-[var(--text-primary)]">
        Prioridade de exposição (estoque parado)
      </h2>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Ranking = estoque atual − vendido no período. Quanto maior, mais unidades sobrando precisam de
        empurrão. Sell-through vem do lado pra dar contexto — grupos grandes tendem a ter diferença alta
        só pelo tamanho, mesmo vendendo bem.
      </p>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Top estoque parado</h2>
        <MetricBarChart
          data={ranked.slice(0, 10).map((r) => ({ key: r.key, value: r.pushScore }))}
          color="var(--status-warning)"
        />
      </section>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">
                {dimension === "grupo" ? "Grupo" : dimension === "produto" ? "Produto" : "Tamanho"}
              </th>
              <th className="px-4 py-2 font-medium">Estoque − Vendas</th>
              <th className="px-4 py-2 font-medium">Estoque atual</th>
              <th className="px-4 py-2 font-medium">Vendido (bruto)</th>
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
        Outras métricas de marketing (campanhas, CAC etc) ainda não estão conectadas.
      </p>
    </div>
  );
}
