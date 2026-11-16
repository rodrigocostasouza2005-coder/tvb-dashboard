import { getSessionUser } from "@/lib/auth";
import { getProdutosPlanejamento, getProdutoPlanejamentoDetalhe, getRecomendacaoGradeProduto, getDistinctGrupos, getDistinctTamanhos } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { toArray, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { StatTile } from "../stat-tile";
import { PlanejamentoFiltros } from "./filtros";
import { ProdutosTable } from "./produtos-table";
import { ProdutoDetalhe } from "./produto-detalhe";

const BASE_PATH = "/dashboard/planejamento-estoque";

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

  const grupoRestricao = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const grupoIn = grupoFiltro.length > 0 ? grupoFiltro.filter((g) => !grupoRestricao || grupoRestricao.includes(g)) : grupoRestricao;

  const filtro = {
    grupoIn,
    tamanhoIn: tamanhoFiltro.length > 0 ? tamanhoFiltro : undefined,
    busca: busca.trim() || undefined,
    storeIdsPermitidas: allowedStores,
  };

  const [grupos, tamanhos, produtos, detalhe, grade] = await Promise.all([
    getDistinctGrupos(),
    getDistinctTamanhos(),
    getProdutosPlanejamento(filtro),
    produtoAberto ? getProdutoPlanejamentoDetalhe(produtoAberto, filtro) : Promise.resolve(null),
    produtoAberto ? getRecomendacaoGradeProduto(produtoAberto, { grupoIn, colecaoIn: undefined }) : Promise.resolve(null),
  ]);

  // Mesma regra de permissão de classificarProdutoAction (mapa-compras/classificacao-actions.ts)
  // — a UI só oferece o botão pra quem a server action aceitaria de qualquer forma (a action
  // reverifica role no servidor de novo, isto é só pra não mostrar um botão que vai falhar).
  const podeClassificar = user.role === "ADMIN" || user.role === "GESTAO";
  const linhaProdutoAberto = produtoAberto ? produtos.find((p) => p.produto === produtoAberto) : undefined;

  const totalProdutos = produtos.length;
  const emRisco = produtos.filter((p) => p.situacao === "ruptura" || p.situacao === "cobertura_critica").length;
  const possivelExcesso = produtos.filter((p) => p.situacao === "cobertura_excessiva").length;
  const semMovimentacao = produtos.filter((p) => p.situacao === "estoque_parado").length;

  const queryParams = new URLSearchParams();
  for (const g of grupoFiltro) queryParams.append("grupo", g);
  for (const t of tamanhoFiltro) queryParams.append("tamanho", t);
  if (busca.trim()) queryParams.set("busca", busca.trim());
  const queryString = queryParams.toString();
  const fecharHref = queryString ? `${BASE_PATH}?${queryString}` : BASE_PATH;

  return (
    <div>
      <p className="mb-4 max-w-4xl text-sm text-[var(--text-secondary)]">
        Visão por produto (agregando todos os SKUs/tamanhos/cores) de estoque, vendas e cobertura. <strong>Fase 1</strong>
        : regras transparentes, sem modelo de previsão sofisticado ainda — cobertura é estoque disponível ÷ velocidade
        média de venda nos últimos 90 dias; &quot;dados insuficientes&quot; aparece quando o produto tem menos de 14 dias de
        histórico de venda. Quantidade em produção/trânsito é exibida separada do estoque disponível porque o DAPIC não
        informa data de chegada confiável hoje.
      </p>

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Produtos no filtro" value={totalProdutos.toLocaleString("pt-BR")} />
        <StatTile label="Risco de ruptura/crítico" value={emRisco.toLocaleString("pt-BR")} status={emRisco > 0 ? "critical" : "good"} />
        <StatTile label="Possível excesso" value={possivelExcesso.toLocaleString("pt-BR")} status={possivelExcesso > 0 ? "warning" : "good"} />
        <StatTile label="Sem movimentação" value={semMovimentacao.toLocaleString("pt-BR")} status={semMovimentacao > 0 ? "warning" : "good"} />
      </section>

      <PlanejamentoFiltros basePath={BASE_PATH} grupos={grupos} tamanhos={tamanhos} value={{ grupoIn: grupoFiltro, tamanhoIn: tamanhoFiltro, busca }} />

      {detalhe && (
        <ProdutoDetalhe
          detalhe={detalhe}
          classificacao={linhaProdutoAberto?.classificacao ?? "NAO_CLASSIFICADO"}
          grade={grade}
          podeClassificar={podeClassificar}
          fecharHref={fecharHref}
        />
      )}

      <ProdutosTable rows={produtos} basePath={BASE_PATH} queryString={queryString} produtoAberto={produtoAberto} />
    </div>
  );
}
