import { getSessionUser } from "@/lib/auth";
import { requireTabAccess } from "@/lib/tabs";
import { canSeeFinancials, getStoreRestriction } from "@/lib/permissions";
import { parseFilters, defaultRecentRangeStr, type RawSearchParams } from "@/lib/filters";
import {
  getResumoBlackFriday,
  periodoAnterior,
  getVendasPorCanal,
  getTopProdutosBlackFriday,
  getSalesByDay,
  getCacEcommerce,
  getCacPorCampanha,
  getFiltrosSemAtacado,
  type DashboardFilters,
} from "@/lib/metrics";
import { getInsightsPorConjunto, getInsightsPorAnuncio, getFotosPorNomeAnuncio, type MetaInsight } from "@/lib/connectors/meta-ads";
import { prisma } from "@/lib/prisma";
import { getSyncStatusDetalhado } from "@/lib/sync-runner";
import { todayBrasiliaStr } from "@/lib/filters";
import { formatBRL, formatNumber, formatPercent } from "@/lib/format";
import { StatTile } from "../stat-tile";
import { GetForm } from "../get-form";
import { IndicatorChart } from "../indicadores/indicator-chart";
import { CanalTable } from "./canal-table";
import { CampanhaTable, type CampanhaRow } from "./campanha-table";
import { ProdutosTable } from "./produtos-table";
import { FonteStatus } from "./fonte-status";

// Investimento em mídia (getInsightsPorConjunto/Anuncio) é lento o suficiente (ver mesmo
// comentário em analytics-site/page.tsx) pra precisar do maxDuration estendido da Vercel.
export const maxDuration = 30;

function pct(current: number, prev: number): number | null {
  if (!prev) return null;
  return ((current - prev) / prev) * 100;
}

function changeLabel(change: number | null): string | undefined {
  if (change === null) return undefined;
  return `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}% vs. período anterior`;
}

function trendPoint(change: number | null) {
  if (change === null) return undefined;
  return change >= 0 ? ("good" as const) : ("critical" as const);
}

function mapInsights(map: Map<string, MetaInsight>, limit: number): CampanhaRow[] {
  return [...map.entries()]
    .map(([nome, insight]) => ({ nome, ...insight }))
    .filter((r) => r.gasto > 0)
    .sort((a, b) => b.gasto - a.gasto)
    .slice(0, limit);
}

export default async function BlackFridayPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "black-friday");

  const showFinancials = canSeeFinancials(user);
  const rawParams = await searchParams;
  const defaults = defaultRecentRangeStr(30);
  const fromStr = typeof rawParams.from === "string" && rawParams.from ? rawParams.from : defaults.from;
  const toStr = typeof rawParams.to === "string" && rawParams.to ? rawParams.to : defaults.to;
  const allowedStoreIds = getStoreRestriction(user);
  const filters: DashboardFilters = parseFilters(rawParams, { allowedStoreIds });
  const anterior = periodoAnterior(filters.from, filters.to);

  // Pedido do Rodrigo (2026-11-05): "não contabilizar atacado na aba de central black friday".
  // Afeta visão geral/ranking de produto/gráfico de receita por dia — NUNCA a tabela "Por canal"
  // (getVendasPorCanal continua recebendo `filters` original, Atacado aparece lá como canal
  // próprio, transparente; ver comentário em black-friday.ts).
  const filtrosSemAtacado = await getFiltrosSemAtacado(filters);
  const filtrosAnteriorSemAtacado: DashboardFilters = { ...filtrosSemAtacado, from: anterior.from, to: anterior.to };

  // Meta Ads (investimento/campanhas) é a parte que pode falhar (token vencido, credencial
  // ausente, rate limit) — isolado num try/catch próprio, igual analytics-site/page.tsx, pra
  // não derrubar o resto da página (vendas por canal, produtos, CAC continuam de pé).
  let erroMetaAds: string | null = null;
  let insightsPorConjunto = new Map<string, MetaInsight>();
  let insightsPorAnuncio = new Map<string, MetaInsight>();
  // Fotos (refinamento visual da missão 2026-11-05, escopo exclusivo da tabela "Por anúncio") —
  // Map vazio por padrão: se a busca de foto falhar, a tabela continua de pé com o fallback
  // visual local (AnuncioFotoCell), nunca com imagem quebrada nem linha vazia.
  let fotosPorAnuncio = new Map<string, string[]>();
  const metaAdsPromise = Promise.all([
    getInsightsPorConjunto({ since: todayBrasiliaStr(filters.from), until: todayBrasiliaStr(filters.to) }),
    getInsightsPorAnuncio({ since: todayBrasiliaStr(filters.from), until: todayBrasiliaStr(filters.to) }),
  ])
    .then(async (r) => {
      [insightsPorConjunto, insightsPorAnuncio] = r;
      // Só busca foto pros nomes que de fato vão aparecer na tabela (top 15 por gasto, mesmo
      // corte de mapInsights abaixo) — mesmo padrão de analytics-site/page.tsx. Isolado em try
      // próprio: erro buscando foto (rate limit, token vencido) não pode derrubar o investimento/
      // CTR/ROAS que já carregaram certinho — só fica sem foto.
      const nomesTopAnuncios = mapInsights(insightsPorAnuncio, 15).map((row) => row.nome);
      try {
        fotosPorAnuncio = await getFotosPorNomeAnuncio(prisma, nomesTopAnuncios);
      } catch {
        // Sem foto agora — AnuncioFotoCell já trata Map vazio/sem entrada com fallback visual.
      }
    })
    .catch((e) => {
      erroMetaAds = e instanceof Error ? e.message : "Erro desconhecido buscando investimento do Meta Ads.";
    });

  const [resumo, resumoAnterior, vendasPorCanal, salesByDay, topProdutos, cac, syncStatus] = await Promise.all([
    getResumoBlackFriday(filtrosSemAtacado),
    getResumoBlackFriday(filtrosAnteriorSemAtacado),
    getVendasPorCanal(filters),
    getSalesByDay(filtrosSemAtacado),
    getTopProdutosBlackFriday(filtrosSemAtacado, 20),
    getCacEcommerce(filters.from, filters.to),
    getSyncStatusDetalhado(),
    metaAdsPromise,
  ]);
  const cacPorCampanha = getCacPorCampanha();

  // Comparativo só aparece quando os DOIS períodos têm pedido real — nunca força uma comparação
  // contra um período vazio (pedido explícito da missão, item 1).
  const temComparacaoValida = resumo.pedidos > 0 && resumoAnterior.pedidos > 0;
  const faturamentoChange = temComparacaoValida ? pct(resumo.faturamento, resumoAnterior.faturamento) : null;
  const pedidosChange = temComparacaoValida ? pct(resumo.pedidos, resumoAnterior.pedidos) : null;
  const pecasChange = temComparacaoValida ? pct(resumo.pecas, resumoAnterior.pecas) : null;
  const ticketChange =
    temComparacaoValida && resumo.ticketMedio != null && resumoAnterior.ticketMedio != null
      ? pct(resumo.ticketMedio, resumoAnterior.ticketMedio)
      : null;

  const salesChartData = salesByDay.map((s) => ({ day: s.day, receita: s.revenue }));
  const campanhasPorConjunto = mapInsights(insightsPorConjunto, 15);
  const campanhasPorAnuncio = mapInsights(insightsPorAnuncio, 15);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Central Black Friday</h1>
      <p className="mb-4 text-sm text-[var(--text-muted)]">
        Visão consolidada do período pra Black Friday: vendas por canal, campanhas de mídia,
        produtos e CAC. Só visão — nenhum desconto ou preço é alterado automaticamente por aqui.
      </p>

      <GetForm action="/dashboard/black-friday" className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="from">De</label>
          <input
            id="from"
            type="date"
            name="from"
            defaultValue={fromStr}
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
            defaultValue={toStr}
            className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
            style={{ colorScheme: "light dark" }}
          />
        </div>
        <button type="submit" className="rounded-md bg-[var(--series-1)] px-4 py-1.5 text-sm font-medium text-white">
          Aplicar
        </button>
      </GetForm>

      <div className="mb-6">
        <FonteStatus status={syncStatus} />
      </div>

      {/* ── Visão geral ── */}
      <h2 className="mb-3 text-base font-semibold">Visão geral</h2>
      <section className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Peças vendidas" value={formatNumber(resumo.pecas)} subValue={changeLabel(pecasChange)} status={trendPoint(pecasChange)} />
        <StatTile label="Pedidos" value={formatNumber(resumo.pedidos)} subValue={changeLabel(pedidosChange)} status={trendPoint(pedidosChange)} />
        {showFinancials && (
          <>
            <StatTile label="Faturamento líquido" value={formatBRL(resumo.faturamento)} subValue={changeLabel(faturamentoChange)} status={trendPoint(faturamentoChange)} />
            <StatTile label="Ticket médio" value={resumo.ticketMedio != null ? formatBRL(resumo.ticketMedio) : "—"} subValue={changeLabel(ticketChange)} status={trendPoint(ticketChange)} />
            <StatTile
              label="Investimento em mídia"
              value={resumo.investimentoIndisponivel ? "indisponível" : formatBRL(resumo.investimentoMidia)}
            />
            <StatTile
              label="ROAS (receita total / mídia)"
              value={resumo.roas != null ? resumo.roas.toFixed(2) : "—"}
              subValue="Receita de TODAS as lojas sobre o gasto total do Meta Ads — não é por canal/campanha"
            />
          </>
        )}
      </section>
      <p className="mb-6 text-xs text-[var(--text-muted)]">
        {temComparacaoValida
          ? "Comparação acima é contra o período imediatamente anterior, de mesma duração."
          : "Sem comparativo com o período anterior: um dos dois períodos não tem pedido registrado."}
      </p>

      <section className="mb-10 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Receita líquida por dia</h3>
        <IndicatorChart
          data={salesChartData}
          format="currency"
          granularity="day"
          series={[{ key: "receita", name: "Receita líquida", color: "var(--series-1)" }]}
        />
      </section>

      {/* ── Por canal ── */}
      <h2 className="mb-3 text-base font-semibold">Por canal</h2>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Cada loja aparece separada por Store.code real — nunca somada por agrupamento visual.
      </p>
      <section className="mb-10">
        <CanalTable rows={vendasPorCanal} showFinancials={showFinancials} />
      </section>

      {/* ── Campanhas ── */}
      <h2 className="mb-3 text-base font-semibold">Campanhas (Meta Ads)</h2>
      {erroMetaAds && (
        <p className="mb-4 rounded-lg border border-[var(--status-critical)] bg-[var(--surface-1)] p-3 text-xs text-[var(--text-secondary)]">
          Investimento/campanhas do Meta Ads indisponíveis agora (não é falta de gasto no período, é um erro real): {erroMetaAds}
        </p>
      )}
      <section className="mb-10 flex flex-col gap-6">
        <CampanhaTable titulo="Por conjunto de anúncios" nomeColuna="Conjunto" rows={campanhasPorConjunto} />
        <CampanhaTable titulo="Por anúncio" nomeColuna="Anúncio" rows={campanhasPorAnuncio} fotos={fotosPorAnuncio} />
      </section>

      {/* ── Produtos ── */}
      <h2 className="mb-3 text-base font-semibold">Produtos</h2>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Ranking de venda líquida no período, com a classificação Best Seller/Drop já cadastrada
        em Inteligência de Compras (não recalculada aqui).
      </p>
      <section className="mb-10">
        <ProdutosTable rows={topProdutos} showFinancials={showFinancials} />
      </section>

      {/* ── CAC ── */}
      <h2 className="mb-3 text-base font-semibold">CAC — Custo de Aquisição de Cliente (e-commerce)</h2>
      {showFinancials ? (
        <>
          <section className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile label="CAC" value={cac.cac != null ? formatBRL(cac.cac) : "—"} />
            <StatTile label="Novos compradores" value={formatNumber(cac.novosCompradores)} subValue={cac.participacaoNovosPct != null ? formatPercent(cac.participacaoNovosPct) : undefined} />
            <StatTile label="Recorrentes" value={formatNumber(cac.recorrentes)} subValue={cac.participacaoRecorrentesPct != null ? formatPercent(cac.participacaoRecorrentesPct) : undefined} />
            <StatTile label="Investimento em mídia" value={cac.investimentoIndisponivel ? "indisponível" : formatBRL(cac.investimento)} />
          </section>
          <p className="mb-6 rounded-lg border border-[var(--status-warning)] bg-[var(--surface-1)] p-3 text-xs text-[var(--text-secondary)]">
            <strong>Limitação deste número (leia antes de usar o CAC pra decisão):</strong> {cac.motivoLimitacao}
          </p>

          <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">CAC por campanha</h3>
          <p className="mb-10 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 text-xs text-[var(--text-secondary)]">
            {cacPorCampanha.disponivel === false ? (
              <>
                <strong>Não disponível.</strong> {cacPorCampanha.motivo}
              </>
            ) : null}
          </p>
        </>
      ) : (
        <p className="mb-10 text-sm text-[var(--text-muted)]">Sem permissão para ver dado financeiro (CAC/investimento).</p>
      )}
    </div>
  );
}
