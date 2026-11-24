import { getSessionUser } from "@/lib/auth";
import {
  getProdutosPlanejamento,
  getProdutoPlanejamentoDetalhe,
  getRecomendacaoGradeProduto,
  getDistinctGrupos,
  getDistinctTamanhos,
  getProdutoExcessoDistribuicao,
  getDecisoesMovimentacaoPorStatus,
  getReposicaoBestSellerConsolidada,
  getEstoqueMinimoManualDosCods,
  getHistoricoDecisoesCompra,
  sintetizarRecomendacaoPrincipal,
  type ProdutoPlanejamento,
} from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { toArray, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { StatTile } from "../stat-tile";
import { PlanejamentoFiltros } from "./filtros";
import { ProdutosTable, type SortDir, ordenarProdutos, parseSortKey } from "./produtos-table";
import { ProdutoDetalhe } from "./produto-detalhe";
import { ReposicaoBestSellerSection } from "./reposicao-bestseller";

const BASE_PATH = "/dashboard/planejamento-estoque";

// Zona 1 — "KPIs navegáveis (clicar aplica filtro na lista)", pedido explícito do Rodrigo. Mapeia
// exatamente os mesmos critérios usados pra calcular o NÚMERO de cada StatTile abaixo — clicar
// sempre filtra a lista pro mesmo conjunto que o número exibido representa, nunca uma aproximação.
type SituacaoFiltro = "risco" | "excesso" | "parado";
const SITUACAO_FILTROS_VALIDOS: SituacaoFiltro[] = ["risco", "excesso", "parado"];

function matchesSituacaoFiltro(situacao: ProdutoPlanejamento["situacao"], filtro: SituacaoFiltro | undefined): boolean {
  if (!filtro) return true;
  if (filtro === "risco") return situacao === "ruptura" || situacao === "cobertura_critica";
  if (filtro === "excesso") return situacao === "cobertura_excessiva";
  return situacao === "estoque_parado"; // "parado" — nunca inclui lancamento_recente (contador separado, ver subValue)
}

const SITUACAO_FILTRO_LABEL: Record<SituacaoFiltro, string> = {
  risco: "Risco de ruptura/crítico",
  excesso: "Possível excesso",
  parado: "Sem movimentação",
};

export default async function PlanejamentoEstoquePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "planejamento-estoque");

  const rawParams = await searchParams;
  const grupoFiltro = toArray(rawParams.grupo);
  const tamanhoFiltro = toArray(rawParams.tamanho);
  const busca = typeof rawParams.busca === "string" ? rawParams.busca : "";
  const produtoAberto = typeof rawParams.produto === "string" ? rawParams.produto : undefined;
  const situacaoRaw = typeof rawParams.situacao === "string" ? rawParams.situacao : undefined;
  const situacaoFiltro = SITUACAO_FILTROS_VALIDOS.includes(situacaoRaw as SituacaoFiltro) ? (situacaoRaw as SituacaoFiltro) : undefined;
  const sort = parseSortKey(typeof rawParams.sort === "string" ? rawParams.sort : "produto");
  const dirRaw = typeof rawParams.dir === "string" ? rawParams.dir : "asc";
  const dir: SortDir = dirRaw === "desc" ? "desc" : "asc";

  const grupoRestricao = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const grupoIn = grupoFiltro.length > 0 ? grupoFiltro.filter((g) => !grupoRestricao || grupoRestricao.includes(g)) : grupoRestricao;

  const filtro = {
    grupoIn,
    tamanhoIn: tamanhoFiltro.length > 0 ? tamanhoFiltro : undefined,
    busca: busca.trim() || undefined,
    storeIdsPermitidas: allowedStores,
  };

  const [grupos, tamanhos, produtosTodos, detalhe, grade, reposicaoBestSeller] = await Promise.all([
    getDistinctGrupos(),
    getDistinctTamanhos(),
    getProdutosPlanejamento(filtro),
    produtoAberto ? getProdutoPlanejamentoDetalhe(produtoAberto, filtro) : Promise.resolve(null),
    produtoAberto ? getRecomendacaoGradeProduto(produtoAberto, { grupoIn, colecaoIn: undefined }) : Promise.resolve(null),
    // Painel consolidado (empresa toda) — restrito só por permissão de loja/grupo do usuário,
    // nunca pelos filtros de query string (grupoFiltro/tamanhoFiltro/busca/situacao) que regem a
    // tabela de produtos abaixo: este painel sempre mostra TODO o universo Best Seller permitido.
    getReposicaoBestSellerConsolidada({ grupoIn: grupoRestricao, storeIdsPermitidas: allowedStores }),
  ]);

  // Mesma regra de permissão de classificarProdutoAction (mapa-compras/classificacao-actions.ts)
  // — a UI só oferece o botão pra quem a server action aceitaria de qualquer forma (a action
  // reverifica role no servidor de novo, isto é só pra não mostrar um botão que vai falhar).
  const podeClassificar = user.role === "ADMIN" || user.role === "GESTAO";
  const linhaProdutoAberto = produtoAberto ? produtosTodos.find((p) => p.produto === produtoAberto) : undefined;

  // Fase 2B (ajuste de regra Rodrigo 2026-11-17): busca excesso/distribuição (e as decisões já
  // registradas) pra QUALQUER produto aberto, não só Best Seller/Drop — produto não classificado/
  // MISTO também precisa aparecer nessa visão, nunca ser escondido. getProdutoExcessoDistribuicao
  // reaproveita a mesma passada cacheada de getComparacaoCompleta/getMovimentacoesRecomendadas que
  // distribuicao-estoque já usa — não é uma query nova pesada.
  const classificacaoAberta = linhaProdutoAberto?.classificacao ?? "NAO_CLASSIFICADO";
  const buscarDadosDetalhe = Boolean(produtoAberto) && detalhe != null;
  const [excessoDistribuicao, decisoesMovimentacao, minimoManualDoProduto, decisoesCompraDoProduto] = await Promise.all([
    buscarDadosDetalhe ? getProdutoExcessoDistribuicao(produtoAberto!, filtro) : Promise.resolve(null),
    buscarDadosDetalhe ? getDecisoesMovimentacaoPorStatus({ produto: produtoAberto }) : Promise.resolve(null),
    buscarDadosDetalhe ? getEstoqueMinimoManualDosCods(detalhe!.cods, filtro) : Promise.resolve([]),
    buscarDadosDetalhe ? getHistoricoDecisoesCompra({ codIn: detalhe!.cods }) : Promise.resolve([]),
  ]);

  // Síntese da recomendação principal (Aba 1 "Visão Geral do produto") — pura, sem cálculo novo,
  // só prioriza o que os motores já maduros retornaram (ver planejamento-recomendacao.ts).
  const recomendacaoPrincipal =
    detalhe && linhaProdutoAberto
      ? sintetizarRecomendacaoPrincipal({
          situacao: linhaProdutoAberto.situacao,
          classificacao: linhaProdutoAberto.classificacao,
          demandaPossivelmenteMascarada: linhaProdutoAberto.demandaPossivelmenteMascarada,
          excesso: excessoDistribuicao,
          recomendacoesBestSeller: detalhe.recomendacoesBestSeller,
          recomendacoesDrop: detalhe.recomendacoesDrop,
        })
      : null;

  // Zona 1 — totais SEMPRE sobre o universo completo do filtro de grupo/tamanho/busca (nunca
  // afetados pelo próprio filtro de situação) — é o que os cliques de KPI comparam contra.
  const totalProdutos = produtosTodos.length;
  const emRisco = produtosTodos.filter((p) => matchesSituacaoFiltro(p.situacao, "risco")).length;
  const possivelExcesso = produtosTodos.filter((p) => matchesSituacaoFiltro(p.situacao, "excesso")).length;
  const semMovimentacao = produtosTodos.filter((p) => matchesSituacaoFiltro(p.situacao, "parado")).length;
  const recemLancados = produtosTodos.filter((p) => p.situacao === "lancamento_recente").length;

  // Zona 2 — filtro de situação (clique no KPI) + ordenação, ambos aplicados em memória sobre o
  // resultado já buscado (mesmo padrão do filtro "nível de desequilíbrio" em distribuicao-estoque/
  // page.tsx) — nenhuma query nova, só exibição.
  const produtosFiltrados = produtosTodos.filter((p) => matchesSituacaoFiltro(p.situacao, situacaoFiltro));
  const produtos = ordenarProdutos(produtosFiltrados, sort, dir);

  const queryParamsBase = new URLSearchParams();
  for (const g of grupoFiltro) queryParamsBase.append("grupo", g);
  for (const t of tamanhoFiltro) queryParamsBase.append("tamanho", t);
  if (busca.trim()) queryParamsBase.set("busca", busca.trim());
  const queryStringBase = queryParamsBase.toString();

  function hrefComSituacao(situacao: SituacaoFiltro | undefined) {
    const qs = new URLSearchParams(queryStringBase);
    if (situacao) qs.set("situacao", situacao);
    return `${BASE_PATH}?${qs.toString()}`;
  }

  // A querystring que acompanha a tabela/abertura de produto PRECISA incluir situacao/sort/dir
  // também — é assim que "manter seleção de produto e filtros ao navegar entre abas" se estende
  // pro filtro de KPI e pra ordenação, não só grupo/tamanho/busca.
  const queryParamsTabela = new URLSearchParams(queryStringBase);
  if (situacaoFiltro) queryParamsTabela.set("situacao", situacaoFiltro);
  if (sort !== "produto") queryParamsTabela.set("sort", sort);
  if (dir !== "asc") queryParamsTabela.set("dir", dir);
  const queryString = queryParamsTabela.toString();
  const fecharHref = queryString ? `${BASE_PATH}?${queryString}` : BASE_PATH;

  // Deep link pra Distribuição de Estoque já filtrado por este produto (busca é por nome/cod, ver
  // distribuicao-estoque/page.tsx) — é o "abrir lado a lado" decidido pra decisão/execução real,
  // em vez de duplicar o fluxo de Aprovar/Recusar aqui.
  const distribuicaoHref = produtoAberto
    ? `/dashboard/distribuicao-estoque?aba=movimentacoes&busca=${encodeURIComponent(produtoAberto)}`
    : "/dashboard/distribuicao-estoque";

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Planejamento de Estoque</h1>
      <p className="mb-4 max-w-4xl text-sm text-[var(--text-secondary)]">
        Centro de decisão operacional: o que temos em estoque, onde está, o que exige ação, e o que fazer — comprar,
        transferir, aguardar ou reduzir exposição. Cobertura é estoque disponível ÷ velocidade média de venda nos
        últimos 90 dias; &quot;dados insuficientes&quot; aparece quando o produto tem menos de 14 dias de histórico de
        venda. Quantidade em produção/trânsito é exibida separada do estoque disponível porque o DAPIC não informa
        data de chegada confiável hoje.
      </p>

      {/* Zona 1 — Visão Geral: hierarquia do que exige ação, KPIs navegáveis. */}
      <section className="mb-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <a href={hrefComSituacao(undefined)} className="block rounded-lg transition hover:opacity-85">
          <StatTile label="Produtos no filtro" value={totalProdutos.toLocaleString("pt-BR")} />
        </a>
        <a href={hrefComSituacao("risco")} className="block rounded-lg transition hover:opacity-85">
          <StatTile label="Risco de ruptura/crítico" value={emRisco.toLocaleString("pt-BR")} status={emRisco > 0 ? "critical" : "good"} />
        </a>
        <a href={hrefComSituacao("excesso")} className="block rounded-lg transition hover:opacity-85">
          <StatTile label="Possível excesso" value={possivelExcesso.toLocaleString("pt-BR")} status={possivelExcesso > 0 ? "warning" : "good"} />
        </a>
        <a href={hrefComSituacao("parado")} className="block rounded-lg transition hover:opacity-85">
          <StatTile
            label="Sem movimentação"
            value={semMovimentacao.toLocaleString("pt-BR")}
            subValue={recemLancados > 0 ? `+${recemLancados} recém-lançado(s) (não contado aqui)` : undefined}
            status={semMovimentacao > 0 ? "warning" : "good"}
          />
        </a>
      </section>

      {situacaoFiltro && (
        <p className="mb-4 text-xs text-[var(--text-secondary)]">
          Filtrando por: <strong>{SITUACAO_FILTRO_LABEL[situacaoFiltro]}</strong> ·{" "}
          <a href={hrefComSituacao(undefined)} className="text-[var(--series-1)] hover:underline">
            limpar
          </a>
        </p>
      )}

      <ReposicaoBestSellerSection itens={reposicaoBestSeller} podeEditarMinimo={podeClassificar} />

      {/* Zona 2 — Lista/Priorização de produtos. */}
      <PlanejamentoFiltros basePath={BASE_PATH} grupos={grupos} tamanhos={tamanhos} value={{ grupoIn: grupoFiltro, tamanhoIn: tamanhoFiltro, busca }} />

      {/* Zona 3 — Análise individual do produto, só quando um produto está aberto. */}
      {detalhe && (
        <ProdutoDetalhe
          detalhe={detalhe}
          linha={linhaProdutoAberto}
          classificacao={classificacaoAberta}
          grade={grade}
          podeClassificar={podeClassificar}
          fecharHref={fecharHref}
          excessoDistribuicao={excessoDistribuicao}
          decisoesMovimentacao={decisoesMovimentacao}
          decisoesCompra={decisoesCompraDoProduto}
          minimoManual={minimoManualDoProduto}
          recomendacaoPrincipal={recomendacaoPrincipal}
          distribuicaoHref={distribuicaoHref}
          basePath={BASE_PATH}
          searchParams={rawParams}
        />
      )}

      <ProdutosTable rows={produtos} basePath={BASE_PATH} queryString={queryString} produtoAberto={produtoAberto} sort={sort} dir={dir} />
    </div>
  );
}
