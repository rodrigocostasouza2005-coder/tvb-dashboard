import { getSessionUser } from "@/lib/auth";
import { requireTabAccess } from "@/lib/tabs";
import { canSeeFinancials, getStoreRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import {
  getResumoBlackFriday,
  periodoAnterior,
  getVendasPorCanal,
  getSalesByDay,
  getCacEcommerce,
  getFiltrosSemAtacado,
  getVendasPorFaixaDesconto,
  getComparativoMetaDiariaBlackFriday,
  getCacDiarioBlackFriday,
  getVendasPorEstadoEcommerce,
  getTop20ProdutosComDesconto,
  getTop20GruposComDesconto,
  getStores,
  type DashboardFilters,
} from "@/lib/metrics";
import {
  getInsightsPorConjunto,
  getInsightsPorAnuncio,
  getFotosPorNomeAnuncio,
  getAtivoPorNomeConjunto,
  getAtivoPorNomeAnuncio,
  type MetaInsight,
  type AtivoStatus,
} from "@/lib/connectors/meta-ads";
import { prisma } from "@/lib/prisma";
import { getSyncStatusDetalhado } from "@/lib/sync-runner";
import { todayBrasiliaStr } from "@/lib/filters";
import { defaultFiltroBlackFridayStr } from "@/lib/black-friday-banner";
import { formatBRL, formatNumber, formatPercent } from "@/lib/format";
import { StatTile } from "../stat-tile";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { IndicatorChart } from "../indicadores/indicator-chart";
import { BrazilMap } from "../brazil-map";
import { CanalTable } from "./canal-table";
import { CampanhaTable } from "./campanha-table";
import { mapInsights, statusAtivoIndisponivel } from "./campanhas-ativas";
import { FaixaDescontoTable } from "./faixa-desconto-table";
import { Top20DescontoTable } from "./top20-desconto-table";
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
  // Pedido do Rodrigo (2026-11-06): a partir do início real da campanha, o filtro PADRÃO desta
  // aba passa a sempre começar no dia da campanha (ver defaultFiltroBlackFridayStr,
  // black-friday-banner.ts) — Rodrigo pode mudar manualmente a qualquer momento (rawParams.from/
  // to abaixo sempre tem prioridade sobre o padrão).
  const defaults = defaultFiltroBlackFridayStr();
  const fromStr = typeof rawParams.from === "string" && rawParams.from ? rawParams.from : defaults.from;
  const toStr = typeof rawParams.to === "string" && rawParams.to ? rawParams.to : defaults.to;
  const allowedStoreIds = getStoreRestriction(user);
  // fromStr/toStr (acima) já resolvem "o que vai aparecer nos campos de data" (query string, senão
  // o padrão da campanha). Passar os dois explicitamente pro parseFilters garante que o filtro que
  // de fato roda nas queries é SEMPRE o mesmo que aparece preenchido na tela — antes, parseFilters
  // recebia rawParams puro e caía no PRÓPRIO default dele (últimos 30 dias) sempre que from/to não
  // vinham na URL, diferente do default da campanha mostrado nos inputs. Bug achado pelo Rodrigo
  // em 2026-11-10: a tela abria mostrando "De 10/11 Até 10/11" mas os números batiam com os
  // últimos 30 dias.
  const filters: DashboardFilters = parseFilters({ ...rawParams, from: fromStr, to: toStr }, { allowedStoreIds });
  const anterior = periodoAnterior(filters.from, filters.to);
  const filtrosOpen = rawParams.filtros === "1";
  // getStores já agrupa CD+ATACADO numa opção só ("TVB Site e Atacado") — ATACADO nunca aparece
  // como opção separada aqui, então não precisa de tratamento extra: mesmo se o usuário escolher
  // essa opção agrupada, getFiltrosSemAtacado (abaixo) sempre remove o id do ATACADO do resultado.
  const stores = await getStores(allowedStoreIds);

  // Pedido do Rodrigo (2026-11-05, reforçado em 2026-11-06: "eu quero que tire qualquer venda do
  // atacado dessa aba"). Afeta TODA a Central Black Friday agora, inclusive a tabela "Por canal"
  // — a versão anterior mantinha a linha do Atacado ali de propósito (transparência de origem),
  // mas Rodrigo deixou claro que não quer NENHUMA venda de Atacado nesta aba, nem como linha
  // informativa. getVendasPorCanal agora recebe filtrosSemAtacado como todo o resto.
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
  // "Ativo"/"Pausado" por effective_status real (pedido original do Rodrigo em 2026-11-06, PR
  // #56). PR #58 tinha trocado isso por um FILTRO (removia pausado da tabela) e tirado o selo —
  // Rodrigo testou de novo e pediu pra voltar: "o selo Ativo/Pausado, mas mostrando todos" (não
  // dava pra comparar ativo vs. pausado sem ver os dois lado a lado). undefined por padrão (não
  // Map vazio): CampanhaTable só desenha o selo quando a prop existe de verdade; Map vazio faria
  // TODO conjunto/anúncio aparecer como "Pausado" por engano caso essa busca falhe — pior do que
  // simplesmente não mostrar o selo nesse caso (ver statusAtivoIndisponivel). Aplica-se às DUAS
  // tabelas (conjunto e anúncio) — diferente de fotos, que é só da "Por anúncio".
  let ativoPorConjunto: Map<string, AtivoStatus> | undefined;
  let ativoPorAnuncio: Map<string, AtivoStatus> | undefined;
  const metaAdsPromise = Promise.all([
    getInsightsPorConjunto({ since: todayBrasiliaStr(filters.from), until: todayBrasiliaStr(filters.to) }),
    getInsightsPorAnuncio({ since: todayBrasiliaStr(filters.from), until: todayBrasiliaStr(filters.to) }),
  ])
    .then(async (r) => {
      [insightsPorConjunto, insightsPorAnuncio] = r;
      // Só busca foto/status pros nomes que de fato vão aparecer na tabela (top-15 por gasto
      // bruto, mesmo corte de mapInsights abaixo — status não participa dessa seleção, só vira
      // selo depois) — mesmo padrão de analytics-site/page.tsx. Isolado em try próprio: erro
      // buscando foto/status (rate limit, token vencido) não pode derrubar o investimento/CTR/ROAS
      // que já carregaram certinho — só fica sem foto/selo.
      const nomesTopConjuntos = mapInsights(insightsPorConjunto, 15).map((row) => row.nome);
      const nomesTopAnuncios = mapInsights(insightsPorAnuncio, 15).map((row) => row.nome);
      try {
        fotosPorAnuncio = await getFotosPorNomeAnuncio(prisma, nomesTopAnuncios);
      } catch {
        // Sem foto agora — AnuncioFotoCell já trata Map vazio/sem entrada com fallback visual.
      }
      try {
        [ativoPorConjunto, ativoPorAnuncio] = await Promise.all([
          getAtivoPorNomeConjunto(prisma, nomesTopConjuntos),
          getAtivoPorNomeAnuncio(prisma, nomesTopAnuncios),
        ]);
      } catch {
        // Sem status agora — permanece undefined, CampanhaTable não desenha o selo (nunca mostra
        // "Pausado" errado pra quem está rodando de verdade); statusAtivoIndisponivel avisa o
        // Rodrigo que só o SELO ficou indisponível, a tabela em si está normal.
      }
    })
    .catch((e) => {
      erroMetaAds = e instanceof Error ? e.message : "Erro desconhecido buscando investimento do Meta Ads.";
    });

  const [resumo, resumoAnterior, vendasPorCanal, salesByDay, vendasPorFaixaDesconto, comparativoMetaDiaria, cacDiario, vendasPorEstadoEcommerce, cac, syncStatus] = await Promise.all([
    getResumoBlackFriday(filtrosSemAtacado),
    getResumoBlackFriday(filtrosAnteriorSemAtacado),
    getVendasPorCanal(filtrosSemAtacado),
    getSalesByDay(filtrosSemAtacado),
    getVendasPorFaixaDesconto(filtrosSemAtacado),
    // Escopo MAIS ESTREITO que o resto da tela: só a loja CD (e-commerce) — "a meta é só
    // ecommerce" (Rodrigo, 2026-11-06). Por isso recebe `filters` (o range escolhido na página),
    // não `filtrosSemAtacado` — a exclusão de Atacado é resolvida por dentro da própria função
    // (força storeIds=[cdStoreId]), igual getVendasPorEstadoEcommerce.
    getComparativoMetaDiariaBlackFriday(filters),
    // Drill-down diário do CAC — mesma janela cadastrada em MetaDiariaBlackFriday que o
    // comparativo acima (ver getCacDiarioBlackFriday), mesmo motivo de receber `filters`.
    getCacDiarioBlackFriday(filters),
    // Escopo MAIS ESTREITO que o resto da tela: só a loja CD (e-commerce), não "todas menos
    // Atacado" — por isso recebe `filters` (o range da campanha), não `filtrosSemAtacado`. Ver
    // comentário completo em getVendasPorEstadoEcommerce (black-friday.ts).
    getVendasPorEstadoEcommerce(filters),
    getCacEcommerce(filters.from, filters.to),
    getSyncStatusDetalhado(),
    metaAdsPromise,
  ]);
  const participacaoSemEstadoPct =
    vendasPorEstadoEcommerce.receitaBrutaTotal > 0
      ? (vendasPorEstadoEcommerce.semEstado.receita / vendasPorEstadoEcommerce.receitaBrutaTotal) * 100
      : null;
  const estadoMaisFaturamento = [...vendasPorEstadoEcommerce.rows].sort((a, b) => b.receita - a.receita)[0];
  // Reaproveita resumo.faturamento (já calculado acima pra Visão Geral) como total do período
  // pra "% do faturamento" de cada linha — nunca recalcula um total diferente aqui (ver
  // getTop20ProdutosComDesconto/getTop20GruposComDesconto em black-friday.ts). Busca as DUAS
  // visões (produto e grupo) de uma vez — o toggle na tabela é só client-side, sem round-trip
  // novo ao trocar (pedido do Rodrigo em 2026-11-08).
  const [top20ProdutosDesconto, top20GruposDesconto] = await Promise.all([
    getTop20ProdutosComDesconto(filtrosSemAtacado, resumo.faturamento),
    getTop20GruposComDesconto(filtrosSemAtacado, resumo.faturamento),
  ]);

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
  // Gráfico "Meta vs. Real" — 3 séries por dia (meta 2026/real 2026/real 2025). real2025 pode ser
  // null por dia (planilha sem dado) — IndicatorChart já trata null como "sem ponto" (corta a
  // linha em vez de cair pra zero, ver comentário do componente), nunca fabricado aqui.
  const metaDiariaChartData = comparativoMetaDiaria.dias.map((d) => ({
    day: d.data,
    meta2026: d.metaReceita2026,
    real2026: d.receitaReal2026,
    real2025: d.receitaReal2025,
  }));
  // Gráficos "CAC diário" — 3 cartões (investimento/novos/CAC) em vez de 1 gráfico de 3 séries:
  // as escalas são incompatíveis demais pra compartilhar 1 eixo Y (investimento em milhares de
  // reais vs. novos clientes em unidades vs. CAC também em reais mas numa ordem de grandeza bem
  // menor) — mesmo padrão já usado nesta base pra métricas relacionadas com unidades diferentes
  // (ver "Conteúdos/% de qualificação/Engajamento médio" em analise-performance/page.tsx). investimento
  // e cac podem vir null por dia (Meta Ads indisponível, ou 0 novos no dia) — IndicatorChart já
  // corta a linha em null em vez de cair pra zero, nunca fabricado aqui.
  const cacDiarioInvestimentoChartData = cacDiario.dias.map((d) => ({ day: d.data, investimento: d.investimento }));
  const cacDiarioNovosChartData = cacDiario.dias.map((d) => ({ day: d.data, novos: d.novos, recorrentes: d.recorrentes }));
  const cacDiarioCacChartData = cacDiario.dias.map((d) => ({ day: d.data, cac: d.cac }));
  const cacDiarioNaoIdentificadosTotal = cacDiario.dias.reduce((s, d) => s + d.naoIdentificados, 0);
  const cacDiarioNovosTotal = cacDiario.dias.reduce((s, d) => s + d.novos, 0);
  const cacDiarioRecorrentesTotal = cacDiario.dias.reduce((s, d) => s + d.recorrentes, 0);

  const campanhasPorConjunto = mapInsights(insightsPorConjunto, 15);
  const campanhasPorAnuncio = mapInsights(insightsPorAnuncio, 15);
  // Aviso: status indisponível (não erro geral do Meta Ads, que já tem a própria mensagem acima)
  // significa só que o SELO Ativo/Pausado por linha não pôde ser confirmado agora — a tabela em
  // si (seleção por gasto, investimento, CTR, ROAS...) está normal e completa, nada foi escondido.
  const mostrarAvisoStatusIndisponivel = statusAtivoIndisponivel(erroMetaAds, ativoPorConjunto, ativoPorAnuncio);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Central Black Friday</h1>
      <p className="mb-4 text-sm text-[var(--text-muted)]">
        Visão consolidada do período pra Black Friday: vendas por canal, campanhas de mídia,
        produtos e CAC. Só visão — nenhum desconto ou preço é alterado automaticamente por aqui.
      </p>

      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/black-friday"
          stores={stores}
          marcas={[]}
          filters={filters}
          showMarca={false}
          showTabelaPreco={false}
          showColecao={false}
          showDate
        />
      </CollapsibleFilters>

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
              label="ROAS (e-commerce)"
              value={resumo.roas != null ? resumo.roas.toFixed(2) : "—"}
              subValue="Receita líquida só do site (CD) sobre o gasto total do Meta Ads — não lojas físicas/Atacado"
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

      {/* ── Meta diária (campanha) ── */}
      <h2 className="mb-3 text-base font-semibold">Meta vs. real — campanha</h2>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Meta de faturamento 2026 e real de 2025, dia a dia, da planilha da campanha — escopo
        restrito ao período que ela cobre (não o filtro De/Até acima). Faturamento real 2026 já
        sem Atacado, mesma regra do resto desta aba.
      </p>
      {showFinancials ? (
        <>
          <section className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile
              label="Faturamento hoje"
              value={comparativoMetaDiaria.hoje ? formatBRL(comparativoMetaDiaria.hoje.receitaReal2026) : "—"}
              subValue={comparativoMetaDiaria.hoje ? undefined : "Hoje está fora do período da campanha cadastrado"}
            />
            <StatTile
              label="Meta do dia"
              value={comparativoMetaDiaria.hoje ? formatBRL(comparativoMetaDiaria.hoje.metaReceita2026) : "—"}
            />
            <StatTile
              label="% atingimento (hoje)"
              value={comparativoMetaDiaria.hoje?.atingimentoPct != null ? formatPercent(comparativoMetaDiaria.hoje.atingimentoPct) : "—"}
              status={comparativoMetaDiaria.hoje?.atingimentoPct != null ? (comparativoMetaDiaria.hoje.atingimentoPct >= 100 ? "good" : "critical") : undefined}
            />
            <StatTile
              label="Diferença (hoje)"
              value={comparativoMetaDiaria.hoje ? formatBRL(comparativoMetaDiaria.hoje.diferencaReal) : "—"}
            />
            <StatTile
              label="Real 2025 (mesmo dia)"
              value={comparativoMetaDiaria.hoje?.receitaReal2025 != null ? formatBRL(comparativoMetaDiaria.hoje.receitaReal2025) : "—"}
              subValue={comparativoMetaDiaria.hoje && comparativoMetaDiaria.hoje.receitaReal2025 == null ? "Sem dado de 2025 pra este dia" : undefined}
            />
            <StatTile
              label="Crescimento anual (hoje)"
              value={comparativoMetaDiaria.hoje?.crescimentoAnualPct != null ? formatPercent(comparativoMetaDiaria.hoje.crescimentoAnualPct) : "—"}
              status={comparativoMetaDiaria.hoje?.crescimentoAnualPct != null ? (comparativoMetaDiaria.hoje.crescimentoAnualPct >= 0 ? "good" : "critical") : undefined}
            />
          </section>
          <section className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile label="Acumulado real 2026" value={formatBRL(comparativoMetaDiaria.acumulado.receitaReal2026)} />
            <StatTile label="Meta acumulada" value={formatBRL(comparativoMetaDiaria.acumulado.metaReceita2026)} />
            <StatTile
              label="% atingimento acumulado"
              value={comparativoMetaDiaria.acumulado.atingimentoPct != null ? formatPercent(comparativoMetaDiaria.acumulado.atingimentoPct) : "—"}
              status={comparativoMetaDiaria.acumulado.atingimentoPct != null ? (comparativoMetaDiaria.acumulado.atingimentoPct >= 100 ? "good" : "critical") : undefined}
            />
            <StatTile label="Diferença acumulada" value={formatBRL(comparativoMetaDiaria.acumulado.diferencaReal)} />
            <StatTile
              label="Crescimento anual (acumulado)"
              value={comparativoMetaDiaria.acumulado.crescimentoAnualAcumuladoPct != null ? formatPercent(comparativoMetaDiaria.acumulado.crescimentoAnualAcumuladoPct) : "—"}
              subValue={comparativoMetaDiaria.acumulado.crescimentoAnualAcumuladoPct == null ? "Nenhum dia da janela tem dado de 2025 ainda" : "Só dias com dado de 2025 (comparação justa)"}
              status={comparativoMetaDiaria.acumulado.crescimentoAnualAcumuladoPct != null ? (comparativoMetaDiaria.acumulado.crescimentoAnualAcumuladoPct >= 0 ? "good" : "critical") : undefined}
            />
          </section>
        </>
      ) : (
        <p className="mb-3 text-sm text-[var(--text-muted)]">Sem permissão para ver dado financeiro (meta/real da campanha).</p>
      )}
      <section className="mb-10 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Meta 2026 vs. real 2026 vs. real 2025, por dia</h3>
        {comparativoMetaDiaria.dias.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            Nenhuma meta diária importada ainda — use o botão &quot;Importar meta diária Black Friday&quot; no Admin.
          </p>
        ) : (
          <IndicatorChart
            data={metaDiariaChartData}
            format="currency"
            granularity="day"
            series={[
              { key: "meta2026", name: "Meta 2026", color: "var(--cat-1)" },
              { key: "real2026", name: "Real 2026", color: "var(--cat-2)" },
              { key: "real2025", name: "Real 2025", color: "var(--cat-3)" },
            ]}
          />
        )}
      </section>

      {/* ── Por canal ── */}
      <h2 className="mb-3 text-base font-semibold">Por canal</h2>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Cada loja aparece separada por Store.code real — nunca somada por agrupamento visual.
      </p>
      <section className="mb-10">
        <CanalTable rows={vendasPorCanal} showFinancials={showFinancials} />
      </section>

      {/* ── Mapa de estados — e-commerce ── */}
      {showFinancials && (
        <>
          <h2 className="mb-3 text-base font-semibold">Mapa de estados — e-commerce (CD)</h2>
          <p className="mb-3 text-xs text-[var(--text-muted)]">
            Só a loja CD (site), período da campanha — mais estreito que o resto desta tela
            (que é CD+Leblon+Rio Sul+Barra). Linhas por estado/cidade são brutas (sem desconto de
            devolução: a devolução não tem como ser rateada por estado, só entra como total abaixo).
          </p>
          {vendasPorEstadoEcommerce.disponivel ? (
            vendasPorEstadoEcommerce.rows.length > 0 ? (
              <section className="mb-10 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatTile label="Receita bruta (CD)" value={formatBRL(vendasPorEstadoEcommerce.receitaBrutaTotal)} />
                  <StatTile label="Devolução (CD, total período)" value={formatBRL(vendasPorEstadoEcommerce.devolucaoTotal)} />
                  <StatTile
                    label="Maior faturamento"
                    value={estadoMaisFaturamento ? estadoMaisFaturamento.estado : "—"}
                    subValue={estadoMaisFaturamento ? formatBRL(estadoMaisFaturamento.receita) : undefined}
                  />
                  <StatTile
                    label="Sem UF identificada"
                    value={formatBRL(vendasPorEstadoEcommerce.semEstado.receita)}
                    subValue={participacaoSemEstadoPct != null ? `${formatPercent(participacaoSemEstadoPct)} do bruto — não distribuído entre estados` : undefined}
                  />
                </div>
                <BrazilMap
                  rows={vendasPorEstadoEcommerce.rows.map((r) => ({ estado: r.estado, receita: r.receita, unidades: r.unidades }))}
                  citiesByState={vendasPorEstadoEcommerce.citiesByState}
                />
                <p className="mt-4 text-xs text-[var(--text-muted)]">
                  Crescimento vs. 2025 e clientes novos por estado ainda não entram aqui: o
                  primeiro exigiria uma base comparável do ano passado (não disponível nesta
                  tela hoje) e o segundo depende do vínculo Sale↔ClienteCadastro, que está sendo
                  construído em paralelo — ver follow-up no PR.
                </p>
              </section>
            ) : (
              <p className="mb-10 text-sm text-[var(--text-muted)]">Sem venda de e-commerce (CD) no período/filtro selecionado.</p>
            )
          ) : (
            <p className="mb-10 text-sm text-[var(--text-muted)]">Mapa de estados indisponível: loja CD não encontrada ou sem permissão para vê-la.</p>
          )}
        </>
      )}

      {/* ── Campanhas ── */}
      <h2 className="mb-3 text-base font-semibold">Campanhas (Meta Ads)</h2>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Top 15 por investimento em cada nível, ativos e pausados juntos — o selo ao lado do nome
        mostra o status real (effective_status do Meta) agora, pra comparar os dois.
      </p>
      {erroMetaAds && (
        <p className="mb-4 rounded-lg border border-[var(--status-critical)] bg-[var(--surface-1)] p-3 text-xs text-[var(--text-secondary)]">
          Investimento/campanhas do Meta Ads indisponíveis agora (não é falta de gasto no período, é um erro real): {erroMetaAds}
        </p>
      )}
      {mostrarAvisoStatusIndisponivel && (
        <p className="mb-4 rounded-lg border border-[var(--status-warning)] bg-[var(--surface-1)] p-3 text-xs text-[var(--text-secondary)]">
          Não foi possível confirmar o status ativo/pausado agora — as tabelas abaixo estão completas normalmente, só sem o selo por linha até a próxima atualização.
        </p>
      )}
      <section className="mb-10 flex flex-col gap-6">
        <CampanhaTable titulo="Por conjunto de anúncios" nomeColuna="Conjunto" rows={campanhasPorConjunto} ativoPorNome={ativoPorConjunto} />
        <CampanhaTable titulo="Por anúncio" nomeColuna="Anúncio" rows={campanhasPorAnuncio} fotos={fotosPorAnuncio} ativoPorNome={ativoPorAnuncio} />
      </section>

      {/* ── Top 20 produtos com desconto real ── */}
      <h2 className="mb-3 text-base font-semibold">Top 20 produtos com desconto real</h2>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Ranking por produto (grupo+produto, nunca por tamanho/cor) — unidades, faturamento e o %
        de desconto cadastrado na planilha de Black Friday. Produto sem linha correspondente na
        planilha mostra desconto indisponível, nunca 0%.
      </p>
      <section className="mb-10">
        <Top20DescontoTable rowsPorProduto={top20ProdutosDesconto} rowsPorGrupo={top20GruposDesconto} showFinancials={showFinancials} />
      </section>

      {/* ── Por faixa de desconto ── */}
      <h2 className="mb-3 text-base font-semibold">Vendas por faixa de desconto</h2>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Desconto REAL aplicado a cada produto (planilha de preços da Black Friday), cruzado com a
        venda líquida do período. Produto vendido sem linha correspondente na planilha conta como
        0% de desconto. Use o dropdown abaixo da tabela pra ver os melhores produtos de cada
        faixa.
      </p>
      <section className="mb-10">
        <FaixaDescontoTable rows={vendasPorFaixaDesconto} showFinancials={showFinancials} />
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

          {/* ── CAC diário (drill-down diário) ── */}
          <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">CAC diário</h3>
          <p className="mb-3 text-xs text-[var(--text-muted)]">
            Mesma janela da campanha cadastrada em &quot;Meta vs. real&quot; acima (não o filtro
            De/Até no topo da página), dia a dia: investimento em mídia, novos clientes e CAC
            resultante. <strong>Limitação (leia antes de usar o CAC diário pra decisão):</strong> {cacDiario.motivoLimitacao}
          </p>
          {cacDiario.dias.length === 0 ? (
            <p className="mb-10 text-sm text-[var(--text-muted)]">
              Nenhuma meta diária importada ainda — use o botão &quot;Importar meta diária Black Friday&quot; no Admin.
            </p>
          ) : (
            <>
              <section className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <StatTile label="Novos (período do gráfico)" value={formatNumber(cacDiarioNovosTotal)} />
                <StatTile label="Recorrentes (período do gráfico)" value={formatNumber(cacDiarioRecorrentesTotal)} />
                <StatTile
                  label="Não identificados"
                  value={formatNumber(cacDiarioNaoIdentificadosTotal)}
                  subValue="Venda sem vínculo de cadastro resolvido — nunca contada como novo ou recorrente"
                />
              </section>
              <section className="mb-10 grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
                  <h4 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Investimento diário (Meta Ads)</h4>
                  {cacDiario.investimentoIndisponivel ? (
                    <p className="flex h-56 items-center justify-center text-center text-sm text-[var(--text-muted)]">
                      Investimento indisponível (Meta Ads sem credenciais ou erro de API nesta chamada).
                    </p>
                  ) : (
                    <IndicatorChart
                      data={cacDiarioInvestimentoChartData}
                      format="currency"
                      granularity="day"
                      series={[{ key: "investimento", name: "Investimento", color: "var(--cat-1)" }]}
                    />
                  )}
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
                  <h4 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Novos clientes por dia (e-commerce)</h4>
                  <IndicatorChart
                    data={cacDiarioNovosChartData}
                    format="number"
                    granularity="day"
                    series={[
                      { key: "novos", name: "Novos", color: "var(--cat-2)" },
                      { key: "recorrentes", name: "Recorrentes", color: "var(--cat-3)" },
                    ]}
                  />
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
                  <h4 className="mb-2 text-xs font-medium text-[var(--text-muted)]">CAC diário</h4>
                  <IndicatorChart
                    data={cacDiarioCacChartData}
                    format="currency"
                    granularity="day"
                    series={[{ key: "cac", name: "CAC", color: "var(--cat-4)" }]}
                  />
                </div>
              </section>
            </>
          )}
        </>
      ) : (
        <p className="mb-10 text-sm text-[var(--text-muted)]">Sem permissão para ver dado financeiro (CAC/investimento).</p>
      )}
    </div>
  );
}
