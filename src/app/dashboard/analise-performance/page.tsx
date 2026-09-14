import { getSessionUser } from "@/lib/auth";
import { requireTabAccess } from "@/lib/tabs";
import {
  parsePerformanceFilters,
  getDistinctPerfis,
  getPerformanceSummary,
  getPerformanceRanking,
  getPerformancePorLoja,
  getStoriesVsPosts,
  getQualificadoVsBasico,
  getPerformanceEvolucao,
  getPerfilDetalhe,
  type Granularidade,
  type RankingRow,
} from "@/lib/performance";
import { getRawStores } from "@/lib/metrics";
import type { RawSearchParams } from "@/lib/filters";
import { CollapsibleFilters } from "../collapsible-filters";
import { StatTile } from "../stat-tile";
import { PerformanceFilterBar } from "../performance/performance-filter-bar";
import { IndicatorChart } from "../indicadores/indicator-chart";

const TIPO_LABEL: Record<string, string> = { STORY: "Story", POST: "Post", REPOST: "Repost", VISITA: "Visita" };

function formatPct(v: number | null) {
  return v != null ? `${v.toFixed(1)}%` : "—";
}
function formatNum(v: number | null) {
  return v != null ? v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : "—";
}

type SortKey = "conteudos" | "pctQualificacao" | "engajamentoTotal" | "engajamentoMedio";
const SORT_LABEL: Record<SortKey, string> = {
  conteudos: "Conteúdos",
  pctQualificacao: "% Qualificação",
  engajamentoTotal: "Engajamento",
  engajamentoMedio: "Engajamento médio",
};

function sortRanking(rows: RankingRow[], sort: SortKey): RankingRow[] {
  return [...rows].sort((a, b) => {
    const av = a[sort] ?? -1;
    const bv = b[sort] ?? -1;
    return bv - av;
  });
}

export default async function AnalisePerformancePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "analise-performance");

  const rawParams = await searchParams;
  const filtrosOpen = rawParams.filtros === "1";
  const filters = parsePerformanceFilters(rawParams);
  const sort: SortKey = ["conteudos", "pctQualificacao", "engajamentoTotal", "engajamentoMedio"].includes(
    String(rawParams.sort)
  )
    ? (rawParams.sort as SortKey)
    : "pctQualificacao";
  const granularidade: Granularidade =
    rawParams.g === "dia" || rawParams.g === "semana" ? rawParams.g : "mes";
  const verPerfil = typeof rawParams.verPerfil === "string" && rawParams.verPerfil ? rawParams.verPerfil : null;

  const [perfis, allStores, summary, rankingRaw, porLoja, storiesVsPosts, qualificadoVsBasico, evolucao, perfilDetalhe] =
    await Promise.all([
      getDistinctPerfis(),
      getRawStores(),
      getPerformanceSummary(filters),
      getPerformanceRanking(filters),
      getPerformancePorLoja(filters),
      getStoriesVsPosts(filters),
      getQualificadoVsBasico(filters),
      getPerformanceEvolucao(filters, granularidade),
      verPerfil ? getPerfilDetalhe(verPerfil, filters) : Promise.resolve(null),
    ]);
  const stores = allStores.filter((s) => s.sellsProducts);

  const ranking = sortRanking(rankingRaw, sort);
  const porLojaOrdenado = [...porLoja].sort((a, b) => (b.pctQualificacao ?? 0) - (a.pctQualificacao ?? 0));

  function baseParams() {
    const p = new URLSearchParams();
    for (const v of filters.perfilIn ?? []) p.append("perfil", v);
    for (const v of filters.storeIds ?? []) p.append("store", v);
    for (const v of filters.tipoIn ?? []) p.append("tipo", v);
    for (const v of filters.classificacaoIn ?? []) p.append("classificacao", v);
    return p;
  }
  function sortHref(s: SortKey) {
    const p = baseParams();
    p.set("sort", s);
    p.set("g", granularidade);
    return `/dashboard/analise-performance?${p.toString()}`;
  }
  function granularidadeHref(g: Granularidade) {
    const p = baseParams();
    p.set("sort", sort);
    p.set("g", g);
    return `/dashboard/analise-performance?${p.toString()}`;
  }
  function perfilHref(perfil: string) {
    const p = baseParams();
    p.set("sort", sort);
    p.set("g", granularidade);
    p.set("verPerfil", perfil);
    return `/dashboard/analise-performance?${p.toString()}`;
  }
  function fecharPerfilHref() {
    const p = baseParams();
    p.set("sort", sort);
    p.set("g", granularidade);
    return `/dashboard/analise-performance?${p.toString()}`;
  }

  // Insights automáticos — só gerados quando há dados o bastante pra dizer algo com confiança
  // (evita "insight" vazio ou enganoso com amostra de 1 conteúdo).
  const insights: string[] = [];
  const rankingComVolume = ranking.filter((r) => r.conteudos >= 3);
  if (rankingComVolume.length >= 2) {
    const melhorQualificacao = [...rankingComVolume].sort(
      (a, b) => (b.pctQualificacao ?? 0) - (a.pctQualificacao ?? 0)
    )[0];
    if (melhorQualificacao.pctQualificacao != null) {
      insights.push(
        `${melhorQualificacao.perfil} apresentou a maior taxa de qualificação no período (${formatPct(melhorQualificacao.pctQualificacao)}, entre perfis com 3+ conteúdos).`
      );
    }
  }
  const storyStat = storiesVsPosts.find((s) => s.tipo === "STORY");
  const postStat = storiesVsPosts.find((s) => s.tipo === "POST");
  if (storyStat?.engajamentoMedio != null && postStat?.engajamentoMedio != null && postStat.engajamentoMedio > 0) {
    const diffPct = ((storyStat.engajamentoMedio - postStat.engajamentoMedio) / postStat.engajamentoMedio) * 100;
    const maior = diffPct >= 0 ? "Story" : "Post";
    insights.push(
      `${maior === "Story" ? "Stories" : "Posts"} apresentaram engajamento médio ${Math.abs(diffPct).toFixed(0)}% ${diffPct >= 0 ? "maior" : "menor"} que ${maior === "Story" ? "Posts" : "Stories"} no período.`
    );
  }
  const qualStat = qualificadoVsBasico.find((c) => c.classificacao === "QUALIFICADO");
  const basicoStat = qualificadoVsBasico.find((c) => c.classificacao === "BASICO");
  if (qualStat?.engajamentoMedio != null && basicoStat?.engajamentoMedio != null && basicoStat.engajamentoMedio > 0) {
    const diffPct = ((qualStat.engajamentoMedio - basicoStat.engajamentoMedio) / basicoStat.engajamentoMedio) * 100;
    insights.push(
      `Conteúdos classificados como qualificados apresentaram, em média, ${Math.abs(diffPct).toFixed(0)}% ${diffPct >= 0 ? "mais" : "menos"} engajamento médio que os básicos no período.`
    );
  }

  // Top performances / pontos de atenção — só com volume mínimo (3+ conteúdos), pra não expor
  // "100% de qualificação" de quem só lançou 1 conteúdo como se fosse um resultado forte.
  const topPerformances = [...rankingComVolume]
    .sort((a, b) => (b.pctQualificacao ?? 0) - (a.pctQualificacao ?? 0))
    .slice(0, 3);
  const pontosDeAtencao = [...rankingComVolume]
    .filter((r) => (r.pctQualificacao ?? 100) < 50)
    .sort((a, b) => (a.pctQualificacao ?? 0) - (b.pctQualificacao ?? 0))
    .slice(0, 3);

  const xKey = granularidade === "mes" ? "month" : "day";
  const evolucaoConteudos = evolucao.map((e) => ({ [xKey]: e.periodo, conteudos: e.conteudos, qualificados: e.qualificados }));
  const evolucaoPct = evolucao.map((e) => ({ [xKey]: e.periodo, pctQualificacao: e.pctQualificacao ?? 0 }));
  const evolucaoEngajamento = evolucao.map((e) => ({ [xKey]: e.periodo, engajamentoMedio: e.engajamentoMedio ?? 0 }));

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Análise de Performance</h1>
      <p className="mb-4 text-sm text-[var(--text-muted)]">
        Indicadores, rankings e comparações calculados em cima do que foi lançado na aba{" "}
        <a href="/dashboard/performance" className="text-[var(--series-1)] hover:underline">Performance</a>.
        Sem lançamento, sem número aqui — nada é estimado.
      </p>

      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <PerformanceFilterBar
          action="/dashboard/analise-performance"
          perfis={perfis}
          stores={stores}
          filters={filters}
          showTipoClassificacao
          extraHidden={{ sort, g: granularidade }}
        />
      </CollapsibleFilters>

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Total de conteúdos" value={formatNum(summary.totalConteudos)} />
        <StatTile label="Stories" value={formatNum(summary.stories)} />
        <StatTile label="Posts" value={formatNum(summary.posts)} />
        <StatTile label="Reposts" value={formatNum(summary.reposts)} />
        <StatTile label="Visitas" value={formatNum(summary.visitas)} />
        <StatTile label="% qualificados" value={formatPct(summary.pctQualificados)} subValue={`${summary.qualificados} de ${summary.totalConteudos}`} />
        <StatTile label="Qualificados" value={formatNum(summary.qualificados)} />
        <StatTile label="Básicos" value={formatNum(summary.basicos)} />
        <StatTile
          label="Engajamento total"
          value={formatNum(summary.engajamentoTotal)}
          subValue={summary.comEngajamento < summary.totalConteudos ? `${summary.comEngajamento} de ${summary.totalConteudos} com engajamento lançado` : undefined}
        />
        <StatTile label="Engajamento médio/conteúdo" value={formatNum(summary.engajamentoMedio)} />
      </section>

      {insights.length > 0 && (
        <section className="mb-6 rounded-lg border border-[var(--series-1)] bg-[var(--surface-1)] p-4">
          <h2 className="mb-2 text-sm font-medium text-[var(--text-primary)]">Insights automáticos</h2>
          <ul className="flex flex-col gap-1.5 text-sm text-[var(--text-secondary)]">
            {insights.map((i, idx) => (
              <li key={idx}>• {i}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-base font-semibold">Ranking de performance</h2>
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          Quantidade e qualidade são métricas diferentes — quem publica mais não é necessariamente
          quem performa melhor. Ordenado por {SORT_LABEL[sort].toLowerCase()} por padrão; troque abaixo.
        </p>
        <div className="mb-3 flex flex-wrap gap-1">
          {(Object.keys(SORT_LABEL) as SortKey[]).map((s) => (
            <a
              key={s}
              href={sortHref(s)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                sort === s
                  ? "border-[var(--series-1)] bg-[var(--series-1)] text-white"
                  : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
              }`}
            >
              {SORT_LABEL[s]}
            </a>
          ))}
        </div>
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Pessoa</th>
                <th className="px-4 py-2 font-medium text-right">Conteúdos</th>
                <th className="px-4 py-2 font-medium text-right">Qualificados</th>
                <th className="px-4 py-2 font-medium text-right">% Qualificação</th>
                <th className="px-4 py-2 font-medium text-right">Engajamento</th>
                <th className="px-4 py-2 font-medium text-right">Engajamento médio</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r, i) => (
                <tr key={r.perfil} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 text-[var(--text-muted)]">{i + 1}</td>
                  <td className="px-4 py-2 font-medium">
                    <a href={perfilHref(r.perfil)} className="hover:underline">{r.perfil}</a>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.conteudos} <span className="text-xs text-[var(--text-muted)]">({r.stories}S/{r.posts}P/{r.reposts}R/{r.visitas}V)</span></td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.qualificados}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatPct(r.pctQualificacao)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNum(r.engajamentoTotal)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNum(r.engajamentoMedio)}</td>
                </tr>
              ))}
              {ranking.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Sem conteúdo lançado no período/filtro selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Stories vs. Posts</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="py-1.5 font-medium">Formato</th>
                <th className="py-1.5 text-right font-medium">Qtd.</th>
                <th className="py-1.5 text-right font-medium">% do total</th>
                <th className="py-1.5 text-right font-medium">% qualificados</th>
                <th className="py-1.5 text-right font-medium">Eng. médio</th>
              </tr>
            </thead>
            <tbody>
              {storiesVsPosts.map((s) => (
                <tr key={s.tipo} className="border-b border-[var(--gridline)] last:border-0">
                  <td className="py-1.5 font-medium">{TIPO_LABEL[s.tipo]}</td>
                  <td className="py-1.5 text-right tabular-nums">{s.quantidade}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatPct(s.participacaoPct)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatPct(s.pctQualificados)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatNum(s.engajamentoMedio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Qualificado vs. Básico</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="py-1.5 font-medium">Classificação</th>
                <th className="py-1.5 text-right font-medium">Qtd.</th>
                <th className="py-1.5 text-right font-medium">%</th>
                <th className="py-1.5 text-right font-medium">Eng. médio</th>
              </tr>
            </thead>
            <tbody>
              {qualificadoVsBasico.map((c) => (
                <tr key={c.classificacao} className="border-b border-[var(--gridline)] last:border-0">
                  <td className="py-1.5 font-medium">{c.classificacao === "QUALIFICADO" ? "Qualificado" : "Básico"}</td>
                  <td className="py-1.5 text-right tabular-nums">{c.quantidade}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatPct(c.pct)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatNum(c.engajamentoMedio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-base font-semibold">Indicadores por loja</h2>
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          Só entra aqui conteúdo com loja marcada no lançamento — conteúdo sem loja não some do
          resto da página, só não aparece nessa quebra específica.
        </p>
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Loja</th>
                <th className="px-4 py-2 font-medium text-right">Conteúdos</th>
                <th className="px-4 py-2 font-medium text-right">Qualificados</th>
                <th className="px-4 py-2 font-medium text-right">% Qualificação</th>
                <th className="px-4 py-2 font-medium text-right">Engajamento médio</th>
              </tr>
            </thead>
            <tbody>
              {porLojaOrdenado.map((l) => (
                <tr key={l.storeId} className="border-b border-[var(--gridline)] last:border-0">
                  <td className="px-4 py-2 font-medium">{l.storeName}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{l.conteudos}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{l.qualificados}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatPct(l.pctQualificacao)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNum(l.engajamentoMedio)}</td>
                </tr>
              ))}
              {porLojaOrdenado.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Nenhum conteúdo com loja marcada no período/filtro selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Evolução no tempo</h2>
          <div className="flex gap-1">
            {(["dia", "semana", "mes"] as Granularidade[]).map((g) => (
              <a
                key={g}
                href={granularidadeHref(g)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                  granularidade === g
                    ? "border-[var(--series-1)] bg-[var(--series-1)] text-white"
                    : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
                }`}
              >
                {g === "dia" ? "Dia" : g === "semana" ? "Semana" : "Mês"}
              </a>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
            <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Conteúdos (total vs. qualificados)</h3>
            <IndicatorChart
              data={evolucaoConteudos}
              format="number"
              granularity={xKey === "month" ? "month" : "day"}
              series={[
                { key: "conteudos", name: "Total", color: "var(--series-1)" },
                { key: "qualificados", name: "Qualificados", color: "var(--series-2)" },
              ]}
            />
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
            <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">% de qualificação</h3>
            <IndicatorChart
              data={evolucaoPct}
              format="percent"
              granularity={xKey === "month" ? "month" : "day"}
              series={[{ key: "pctQualificacao", name: "% qualificação", color: "var(--cat-3)" }]}
            />
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
            <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Engajamento médio</h3>
            <IndicatorChart
              data={evolucaoEngajamento}
              format="number"
              granularity={xKey === "month" ? "month" : "day"}
              series={[{ key: "engajamentoMedio", name: "Eng. médio", color: "var(--cat-4)" }]}
            />
          </div>
        </div>
      </section>

      <section className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--status-good)] bg-[var(--surface-1)] p-4">
          <h2 className="mb-2 text-sm font-medium text-[var(--text-primary)]">🏆 Top performances</h2>
          <p className="mb-2 text-xs text-[var(--text-muted)]">Maior % de qualificação, entre quem tem 3+ conteúdos no período.</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {topPerformances.map((r) => (
              <li key={r.perfil} className="flex items-center justify-between">
                <a href={perfilHref(r.perfil)} className="font-medium hover:underline">{r.perfil}</a>
                <span className="text-[var(--text-secondary)] tabular-nums">{formatPct(r.pctQualificacao)} ({r.conteudos} conteúdos)</span>
              </li>
            ))}
            {topPerformances.length === 0 && <li className="text-[var(--text-muted)]">Sem dado suficiente (mínimo 3 conteúdos por pessoa) no filtro atual.</li>}
          </ul>
        </div>
        <div className="rounded-lg border border-[var(--status-warning)] bg-[var(--surface-1)] p-4">
          <h2 className="mb-2 text-sm font-medium text-[var(--text-primary)]">⚠️ Pontos de atenção</h2>
          <p className="mb-2 text-xs text-[var(--text-muted)]">% de qualificação abaixo de 50%, entre quem tem 3+ conteúdos no período.</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {pontosDeAtencao.map((r) => (
              <li key={r.perfil} className="flex items-center justify-between">
                <a href={perfilHref(r.perfil)} className="font-medium hover:underline">{r.perfil}</a>
                <span className="text-[var(--text-secondary)] tabular-nums">{formatPct(r.pctQualificacao)} ({r.conteudos} conteúdos)</span>
              </li>
            ))}
            {pontosDeAtencao.length === 0 && <li className="text-[var(--text-muted)]">Nenhum ponto de atenção identificado no filtro atual.</li>}
          </ul>
        </div>
      </section>

      {verPerfil && (
        <section className="mb-8 rounded-lg border border-[var(--series-1)] bg-[var(--surface-1)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Análise individual — {verPerfil}</h2>
            <a href={fecharPerfilHref()} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
              Voltar pra visão geral
            </a>
          </div>
          {perfilDetalhe ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label="Conteúdos" value={formatNum(perfilDetalhe.totalConteudos)} subValue={`${perfilDetalhe.stories}S / ${perfilDetalhe.posts}P / ${perfilDetalhe.reposts}R / ${perfilDetalhe.visitas}V`} />
                <StatTile label="% qualificação" value={formatPct(perfilDetalhe.pctQualificacao)} subValue={`${perfilDetalhe.qualificados} de ${perfilDetalhe.totalConteudos}`} />
                <StatTile label="Engajamento total" value={formatNum(perfilDetalhe.engajamentoTotal)} />
                <StatTile label="Engajamento médio" value={formatNum(perfilDetalhe.engajamentoMedio)} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Melhores conteúdos (por engajamento)</h3>
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {perfilDetalhe.melhoresConteudos.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] px-2 py-1.5">
                        <span className="text-[var(--text-secondary)]">{TIPO_LABEL[c.tipo]} — {new Date(c.data).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</span>
                        <span className="tabular-nums font-medium">{c.engajamento?.toLocaleString("pt-BR")}</span>
                      </li>
                    ))}
                    {perfilDetalhe.melhoresConteudos.length === 0 && <li className="text-[var(--text-muted)]">Sem conteúdo com engajamento lançado.</li>}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Piores conteúdos (por engajamento)</h3>
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {perfilDetalhe.pioresConteudos.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] px-2 py-1.5">
                        <span className="text-[var(--text-secondary)]">{TIPO_LABEL[c.tipo]} — {new Date(c.data).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</span>
                        <span className="tabular-nums font-medium">{c.engajamento?.toLocaleString("pt-BR")}</span>
                      </li>
                    ))}
                    {perfilDetalhe.pioresConteudos.length === 0 && <li className="text-[var(--text-muted)]">Poucos conteúdos com engajamento pra separar melhores/piores.</li>}
                  </ul>
                </div>
              </div>
              {perfilDetalhe.registros.some((r) => r.observacoes) && (
                <div>
                  <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Observações</h3>
                  <ul className="flex flex-col gap-1 text-sm text-[var(--text-secondary)]">
                    {perfilDetalhe.registros.filter((r) => r.observacoes).map((r) => (
                      <li key={r.id}>• {new Date(r.data).toLocaleDateString("pt-BR", { timeZone: "UTC" })}: {r.observacoes}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">Sem conteúdo de {verPerfil} no período/filtro selecionado.</p>
          )}
        </section>
      )}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Sobre o &ldquo;Performance Score&rdquo;</h2>
        <p className="text-xs text-[var(--text-muted)]">
          Avaliamos criar uma métrica combinada de qualidade + engajamento + consistência + evolução,
          mas decidimos não implementar ainda: com poucos lançamentos e sem histórico suficiente por
          pessoa, qualquer peso escolhido pra combinar essas dimensões seria arbitrário. Vale revisitar
          depois de algumas semanas de lançamento contínuo, com uma fórmula transparente e justificada.
        </p>
      </section>
    </div>
  );
}
