import { getSessionUser } from "@/lib/auth";
import {
  getMapaDeComprasDetalhado,
  getCrescimentoEsperado,
  getClassificacaoFilterOptions,
  getClassificacaoPorProduto,
  getVisaoConsolidadaCompras,
  getRecomendacoesBestSeller,
  getRecomendacoesDrop,
  getFilaRevisaoClassificacao,
  getTamanhoBreakdown,
} from "@/lib/metrics";
import { StatusComercialProduto } from "@prisma/client";
import { getGrupoRestriction } from "@/lib/permissions";
import { requireTabAccess } from "@/lib/tabs";
import { toArray, type RawSearchParams } from "@/lib/filters";
import { MatrizCompras } from "./mapa-compras-grid";
import { updateCrescimentoAction } from "./actions";
import { InteligenciaFiltros } from "./inteligencia/filtros";
import { ConsolidadoView } from "./inteligencia/consolidado-view";
import { AlertasView } from "./inteligencia/alertas-view";
import { particionarMatrizCompras } from "./matriz-helpers";

export default async function MapaComprasPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "mapa-compras");

  const rawParams = await searchParams;
  const grupoFiltro = toArray(rawParams.grupo);
  const colecaoFiltro = toArray(rawParams.colecao);
  const statusFiltro = toArray(rawParams.status).filter((s): s is StatusComercialProduto =>
    Object.values(StatusComercialProduto).includes(s as StatusComercialProduto)
  );
  const horizonteDias = Number(rawParams.horizonte) || 30;
  const busca = typeof rawParams.busca === "string" ? rawParams.busca : "";

  const grupoRestricaoPermissao = await getGrupoRestriction(user.role);
  const grupoIn =
    grupoFiltro.length > 0 ? grupoFiltro.filter((g) => !grupoRestricaoPermissao || grupoRestricaoPermissao.includes(g)) : grupoRestricaoPermissao;
  const colecaoIn = colecaoFiltro.length > 0 ? colecaoFiltro : undefined;
  const statusComercialIn = statusFiltro.length > 0 ? statusFiltro : undefined;

  const comprasFiltro = { grupoIn, colecaoIn, statusComercialIn, horizonteDiasOverride: horizonteDias };
  // Cobertura e Crescimento alimentam a recomendação de compra da empresa toda — só ADMIN/GESTAO
  // edita (actions.ts já trava isso no servidor; aqui só escondemos o controle de quem não pode).
  const canEdit = user.role === "ADMIN" || user.role === "GESTAO";

  const [grupos, crescimentoPct, classificacaoPorProduto, bsRows, dropRows, filaRevisao, filtroOpcoes, visao] = await Promise.all([
    getMapaDeComprasDetalhado({ grupoIn }),
    getCrescimentoEsperado(),
    getClassificacaoPorProduto(),
    getRecomendacoesBestSeller(comprasFiltro),
    getRecomendacoesDrop(comprasFiltro),
    getFilaRevisaoClassificacao(),
    getClassificacaoFilterOptions(),
    getVisaoConsolidadaCompras(comprasFiltro),
  ]);

  const todosProdutos = [...new Set(grupos.flatMap((g) => g.produtos.map((p) => p.produto)))];
  const tamanhoPorProduto =
    todosProdutos.length > 0
      ? await getTamanhoBreakdown({ from: new Date(0), to: new Date(), grupoIn }, todosProdutos)
      : new Map();

  const bsPorCod = new Map(bsRows.map((r) => [r.cod, r]));
  const dropPorCod = new Map(dropRows.map((r) => [r.cod, r]));
  const todosMeses = grupos[0]?.meses.map((m) => m.mes) ?? [];
  const { bestSeller, drop } = particionarMatrizCompras(grupos, classificacaoPorProduto, bsPorCod, dropPorCod, todosMeses);

  return (
    <div>
      <p className="mb-4 text-sm text-[var(--text-secondary)]">
        Razão de estoque mês a mês por produto (clique pra abrir): Estoque inicial + Recebimento −
        Vendas − Bonificações = Estoque final, que vira o inicial do mês seguinte — essa conta
        fecha exata em toda coluna, sem resto. Colunas com fundo azulado são <strong>projetadas</strong>;
        o resto é <strong>realizado</strong>, reconstruído a partir do estoque atual andando pra
        trás. Estoque nunca aparece negativo, porque fisicamente nunca foi. Estoque ideal = vendas
        projetadas × cobertura (meses, editável por grupo). "Cobertura (meses)" mostra quanto o
        estoque no INÍCIO do mês cobre de vendas — é derivado, não é uma previsão à parte. "Falta
        comprar" é a fatia mês a mês dessa conta; "Sugestão de compra" (abaixo de cada produto) é a
        recomendação explicável da Inteligência de Compras, com premissas à vista — são dois
        números diferentes de propósito, um não substitui o outro.
      </p>

      <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
        <h2 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
          Como chegamos no número de "Vendas" projetadas (colunas futuras, por produto)
        </h2>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-[var(--text-muted)]">
          <li>Pega a receita líquida do GRUPO (não do produto) no mesmo mês do ano anterior.</li>
          <li>
            Aplica o "Crescimento de receita esperado" que você define abaixo (ex: 10% → multiplica
            por 1,10).
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

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--series-1)] bg-[var(--surface-1)] p-3">
        {canEdit ? (
          <form action={updateCrescimentoAction} className="flex items-center gap-2">
            <label className="text-sm text-[var(--text-secondary)]">Crescimento de receita esperado (ano vs. ano):</label>
            <input
              type="number"
              name="crescimentoPct"
              defaultValue={crescimentoPct}
              step={1}
              className="w-20 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-right text-sm tabular-nums text-[var(--text-primary)]"
            />
            <span className="text-sm text-[var(--text-secondary)]">%</span>
            <button type="submit" className="rounded-md border border-[var(--border)] px-2.5 py-1 text-sm text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
              Salvar
            </button>
          </form>
        ) : (
          <span className="text-sm text-[var(--text-secondary)]">
            Crescimento de receita esperado (ano vs. ano): <strong>{crescimentoPct}%</strong>
          </span>
        )}
      </div>

      <ConsolidadoView visao={visao} canEdit={canEdit} />

      <hr className="my-6 border-[var(--border)]" />

      <details className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]" open={filaRevisao.length > 0}>
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)]">
          Fila de revisão &amp; Alertas
          {filaRevisao.length > 0 && (
            <span className="ml-2 rounded-full bg-[var(--status-warning)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {filaRevisao.length}
            </span>
          )}
        </summary>
        <div className="border-t border-[var(--border)] p-4">
          <AlertasView bsRows={bsRows} dropRows={dropRows} filaRevisao={filaRevisao} />
        </div>
      </details>

      <InteligenciaFiltros
        basePath="/dashboard/mapa-compras"
        grupos={filtroOpcoes.grupos}
        colecoes={filtroOpcoes.colecoes}
        statusComercialDisponiveis={filtroOpcoes.statusComercialEmUso}
        value={{ grupoIn: grupoFiltro, colecaoIn: colecaoFiltro, statusComercialIn: statusFiltro, horizonteDias, busca }}
      />

      <MatrizCompras bestSeller={bestSeller} drop={drop} canEdit={canEdit} tamanhoPorProduto={tamanhoPorProduto} busca={busca} />
    </div>
  );
}
