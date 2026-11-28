import { getSessionUser } from "@/lib/auth";
import {
  getMapaDeComprasDetalhado,
  getClassificacaoFilterOptions,
  getClassificacaoPorProduto,
  getVisaoConsolidadaCompras,
  getRecomendacoesBestSeller,
  getRecomendacoesDrop,
  getFilaRevisaoClassificacao,
  getTamanhoBreakdown,
  getAvaliacaoDecisoesPorProdutoGrupoPeriodo,
  getCodsComOportunidadeTransferencia,
  getPosicoesEstoque,
  getDistinctGrupos,
  getDistinctTamanhos,
  getPremissasCrescimento,
  getVisaoAnaliticaMapaCompras,
} from "@/lib/metrics";
import { StatusComercialProduto } from "@prisma/client";
import { getGrupoRestriction } from "@/lib/permissions";
import { requireTabAccess } from "@/lib/tabs";
import { toArray, type RawSearchParams } from "@/lib/filters";
import { MatrizCompras } from "./mapa-compras-grid";
import { InteligenciaFiltros } from "./inteligencia/filtros";
import { ConsolidadoView } from "./inteligencia/consolidado-view";
import { AlertasView } from "./inteligencia/alertas-view";
import { AvaliacaoDecisoesView } from "./avaliacao/avaliacao-view";
import { particionarMatrizCompras } from "./matriz-helpers";
import { TabsNav } from "./tabs-nav";
import { FiltrosAnalitica } from "./visao-analitica/filtros-analitica";
import { VisaoAnaliticaView } from "./visao-analitica/visao-analitica-view";
import { IndicadoresComerciaisCompras } from "./planejamento-mensal/indicadores-comerciais-compras";
import { PremissasDrawer } from "./premissas-drawer";
import { DetalhamentoModal } from "./detalhamento-modal";

const BASE_PATH = "/dashboard/mapa-compras";

export default async function MapaComprasPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "mapa-compras");

  const rawParams = await searchParams;
  const aba = rawParams.aba === "planejamento" ? "planejamento" : "analitica";
  const grupoFiltro = toArray(rawParams.grupo);
  const colecaoFiltro = toArray(rawParams.colecao);
  const statusFiltro = toArray(rawParams.status).filter((s): s is StatusComercialProduto =>
    Object.values(StatusComercialProduto).includes(s as StatusComercialProduto)
  );
  const horizonteDias = Number(rawParams.horizonte) || 30;
  const busca = typeof rawParams.busca === "string" ? rawParams.busca : "";

  // Filtros da Visão Analítica (seção 4/5.1) — `grupo` é compartilhado com InteligenciaFiltros
  // (seção 19: filtros comuns entre as 2 abas); os demais são específicos desta aba.
  const bestSellerFiltro = rawParams.bestSeller === "bs" || rawParams.bestSeller === "nbs" ? rawParams.bestSeller : "todos";
  const posicaoFiltro = typeof rawParams.posicao === "string" ? rawParams.posicao : "";
  const tamanhoFiltro = typeof rawParams.tamanho === "string" ? rawParams.tamanho : "";
  const periodoDias = Number(rawParams.periodo) || 90;

  const premissasAbertas = rawParams.premissas === "1";
  const detalheGrupo = typeof rawParams.detalheGrupo === "string" ? rawParams.detalheGrupo : null;
  const detalheMes = typeof rawParams.detalheMes === "string" ? rawParams.detalheMes : null;

  const grupoRestricaoPermissao = await getGrupoRestriction(user.role);
  const grupoIn =
    grupoFiltro.length > 0 ? grupoFiltro.filter((g) => !grupoRestricaoPermissao || grupoRestricaoPermissao.includes(g)) : grupoRestricaoPermissao;
  const colecaoIn = colecaoFiltro.length > 0 ? colecaoFiltro : undefined;
  const statusComercialIn = statusFiltro.length > 0 ? statusFiltro : undefined;

  const comprasFiltro = { grupoIn, colecaoIn, statusComercialIn, horizonteDiasOverride: horizonteDias };
  // Cobertura, Crescimento e Premissas alimentam a recomendação de compra da empresa toda — só
  // ADMIN/GESTAO edita (actions.ts já trava isso no servidor; aqui só escondemos o controle de
  // quem não pode).
  const canEdit = user.role === "ADMIN" || user.role === "GESTAO";

  const [
    grupos,
    classificacaoPorProduto,
    bsRows,
    dropRows,
    filaRevisao,
    filtroOpcoes,
    visao,
    avaliacoesDecisoes,
    oportunidadesTransferencia,
    posicoesEstoque,
    distinctGrupos,
    distinctTamanhos,
    premissas,
  ] = await Promise.all([
    getMapaDeComprasDetalhado({ grupoIn }),
    getClassificacaoPorProduto(),
    getRecomendacoesBestSeller(comprasFiltro),
    getRecomendacoesDrop(comprasFiltro),
    getFilaRevisaoClassificacao(),
    getClassificacaoFilterOptions(),
    getVisaoConsolidadaCompras(comprasFiltro),
    getAvaliacaoDecisoesPorProdutoGrupoPeriodo(),
    // Sinal aditivo (docs/planejamento-inteligente-estoque.md §16.2 item 3, §19.6): oportunidades
    // de transferência já calculadas pelo motor de Distribuição, reaproveitadas pra avisar antes
    // de uma sugestão de compra — nunca recalculado, nunca altera nenhuma sugestão.
    getCodsComOportunidadeTransferencia({ grupoIn, colecaoIn }),
    getPosicoesEstoque(),
    getDistinctGrupos(),
    getDistinctTamanhos(),
    getPremissasCrescimento(),
  ]);

  const todosProdutos = [...new Set(grupos.flatMap((g) => g.produtos.map((p) => p.produto)))];
  const tamanhoPorProduto =
    todosProdutos.length > 0
      ? await getTamanhoBreakdown({ from: new Date(0), to: new Date(), grupoIn }, todosProdutos)
      : new Map();

  const bsPorCod = new Map(bsRows.map((r) => [r.cod, r]));
  const dropPorCod = new Map(dropRows.map((r) => [r.cod, r]));
  const todosMeses = grupos[0]?.meses.map((m) => m.mes) ?? [];
  const gruposMatriz = particionarMatrizCompras(grupos, classificacaoPorProduto, bsPorCod, dropPorCod, todosMeses);

  // Resumo da Compra da Visão Analítica reaproveita bsRows/dropRows filtrados pelo MESMO grupo
  // (ver visao-analitica-view.tsx) — nunca um 2º cálculo divergente.
  const todasPosicoes = [...posicoesEstoque.lojas, ...(posicoesEstoque.cdSite ? [posicoesEstoque.cdSite] : [])];
  const posicaoSelecionada = todasPosicoes.find((p) => p.posicaoId === posicaoFiltro);

  const visaoAnalitica =
    aba === "analitica"
      ? await getVisaoAnaliticaMapaCompras({
          grupoIn: grupoIn && grupoIn.length > 0 ? grupoIn : undefined,
          bestSeller: bestSellerFiltro,
          storeIds: posicaoSelecionada?.storeIds,
          tamanho: tamanhoFiltro || undefined,
          periodoDias,
        })
      : null;

  function queryAtual(): Record<string, string | string[] | undefined> {
    return {
      aba,
      grupo: grupoFiltro,
      colecao: colecaoFiltro,
      status: statusFiltro,
      horizonte: String(horizonteDias),
      busca,
      bestSeller: bestSellerFiltro,
      posicao: posicaoFiltro,
      tamanho: tamanhoFiltro,
      periodo: String(periodoDias),
    };
  }

  function hrefSemParams(...nomes: string[]): string {
    const params = new URLSearchParams();
    const atual = queryAtual();
    for (const [k, v] of Object.entries(atual)) {
      if (nomes.includes(k)) continue;
      if (typeof v === "string" && v) params.set(k, v);
      else if (Array.isArray(v)) for (const vv of v) params.append(k, vv);
    }
    return `${BASE_PATH}?${params.toString()}`;
  }

  function hrefComParam(chave: string, valor: string): string {
    const params = new URLSearchParams();
    const atual = queryAtual();
    for (const [k, v] of Object.entries(atual)) {
      if (k === chave) continue;
      if (typeof v === "string" && v) params.set(k, v);
      else if (Array.isArray(v)) for (const vv of v) params.append(k, vv);
    }
    params.set(chave, valor);
    return `${BASE_PATH}?${params.toString()}`;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Mapa de Compras</h1>
          <p className="text-sm text-[var(--text-muted)]">Inteligência de demanda, estoque, crescimento e planejamento de compras.</p>
        </div>
        <a
          href={hrefComParam("premissas", "1")}
          className="rounded-md border border-[var(--series-1)] px-3 py-1.5 text-xs font-medium text-[var(--series-1)] hover:bg-[color-mix(in_srgb,var(--series-1)_12%,transparent)]"
        >
          Premissas de Projeção
        </a>
      </div>

      <TabsNav basePath={BASE_PATH} abaAtiva={aba} />

      {aba === "analitica" && visaoAnalitica ? (
        <>
          <FiltrosAnalitica
            basePath={BASE_PATH}
            abaAtiva={aba}
            grupos={distinctGrupos}
            posicoes={todasPosicoes}
            tamanhos={distinctTamanhos}
            value={{ grupo: grupoFiltro[0] ?? "", bestSeller: bestSellerFiltro, posicaoId: posicaoFiltro, tamanho: tamanhoFiltro, periodoDias }}
          />
          <VisaoAnaliticaView
            resultado={visaoAnalitica}
            bsRows={grupoIn && grupoIn.length > 0 ? bsRows.filter((r) => grupoIn.includes(r.grupo)) : bsRows}
            dropRows={grupoIn && grupoIn.length > 0 ? dropRows.filter((r) => grupoIn.includes(r.grupo)) : dropRows}
            nomeEscopo={grupoFiltro[0] ?? "o catálogo filtrado"}
          />
        </>
      ) : (
        <>
          <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
            <h2 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
              Como chegamos no número de "Vendas" projetadas (colunas futuras, por produto)
            </h2>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-[var(--text-muted)]">
              <li>Pega a receita líquida do GRUPO (não do produto) no mesmo mês do ano anterior.</li>
              <li>
                Aplica o crescimento efetivo das <a href={hrefComParam("premissas", "1")} className="text-[var(--series-1)] hover:underline">Premissas de Projeção</a> (cenário × ajuste
                do grupo + ajuste manual do mês), multiplicado pelo momentum real recente.
              </li>
              <li>
                Reparte essa receita projetada do grupo entre os produtos dele, usando o % de
                participação de cada produto na receita do grupo no último mês completo realizado —
                esse percentual fica fixo, não muda mês a mês.
              </li>
              <li>
                Converte a fatia de receita projetada de cada produto em unidades, dividindo pelo preço
                médio de venda desse produto (média dos últimos 3 meses; sem venda nesse período, cai
                pra média do histórico inteiro). Produto sem nenhuma venda histórica projeta 0.
              </li>
            </ol>
          </div>

          <IndicadoresComerciaisCompras grupos={grupos} queryBase={queryAtual()} />

          <InteligenciaFiltros
            basePath={BASE_PATH}
            grupos={filtroOpcoes.grupos}
            colecoes={filtroOpcoes.colecoes}
            statusComercialDisponiveis={filtroOpcoes.statusComercialEmUso}
            value={{ grupoIn: grupoFiltro, colecaoIn: colecaoFiltro, statusComercialIn: statusFiltro, horizonteDias, busca }}
          />

          <MatrizCompras grupos={gruposMatriz} canEdit={canEdit} tamanhoPorProduto={tamanhoPorProduto} busca={busca} />
        </>
      )}

      {/* Achado na auditoria de layout (2026-11-28): esta seção (Verba sugerida/Priorização de
          orçamento, Fila de revisão & Alertas, Avaliação de decisões) ficava ANTES do conteúdo das
          2 abas — como a Fila de revisão abre automaticamente quando há pendências (hoje, 200
          produtos no catálogo de dev), o usuário tinha que rolar por centenas de cards antes de
          ver o dashboard novo de qualquer uma das abas. Preservada 100% (mesmos componentes, mesmo
          comportamento de abrir sozinha quando há pendência), só movida pra DEPOIS do conteúdo
          principal da aba ativa — nunca escondida, só não compete mais pela primeira dobra. */}
      <hr className="my-6 border-[var(--border)]" />

      <ConsolidadoView visao={visao} canEdit={canEdit} />

      <details className="mb-4 mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]" open={filaRevisao.length > 0}>
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)]">
          Fila de revisão &amp; Alertas
          {filaRevisao.length > 0 && (
            <span className="ml-2 rounded-full bg-[var(--status-warning)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {filaRevisao.length}
            </span>
          )}
        </summary>
        <div className="border-t border-[var(--border)] p-4">
          <AlertasView bsRows={bsRows} dropRows={dropRows} filaRevisao={filaRevisao} oportunidadesTransferencia={oportunidadesTransferencia} />
        </div>
      </details>

      <details className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)]">
          Avaliação de decisões de compra (recomendado vs. realizado)
          {avaliacoesDecisoes.length > 0 && (
            <span className="ml-2 rounded-full bg-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
              {avaliacoesDecisoes.length}
            </span>
          )}
        </summary>
        <div className="border-t border-[var(--border)] p-4">
          <AvaliacaoDecisoesView avaliacoes={avaliacoesDecisoes} />
        </div>
      </details>

      {premissasAbertas && (
        <PremissasDrawer
          fecharHref={hrefSemParams("premissas")}
          premissas={premissas}
          posicoes={todasPosicoes}
          grupos={distinctGrupos}
          canEdit={canEdit}
        />
      )}

      {detalheGrupo && detalheMes && (
        <DetalhamentoModal
          grupo={detalheGrupo}
          mes={detalheMes}
          premissas={premissas}
          fecharHref={hrefSemParams("detalheGrupo", "detalheMes")}
        />
      )}
    </div>
  );
}
