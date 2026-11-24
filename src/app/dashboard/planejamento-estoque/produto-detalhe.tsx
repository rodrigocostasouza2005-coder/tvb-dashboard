import type { DecisaoCompra } from "@prisma/client";
import type {
  ProdutoPlanejamentoDetalhe,
  ProdutoPlanejamento,
  ClassificacaoAgregada,
  RecomendacaoGradeProduto,
  ProdutoExcessoDistribuicao,
  DecisoesMovimentacaoPorStatus,
  ItemMinimoManual,
  RecomendacaoPrincipal,
} from "@/lib/metrics";
import type { RawSearchParams } from "@/lib/filters";
import { ProdutoAbaNav, parseProdutoAba, type ProdutoAba } from "./produto-aba-nav";
import { AbaVisaoGeralProduto } from "./aba-visao-geral";
import { AbaGradeProduto } from "./aba-grade";
import { AbaDistribuicaoProduto } from "./aba-distribuicao";
import { AbaReposicaoProduto } from "./aba-reposicao";
import { AbaDecisoesProduto } from "./aba-decisoes";

// Zona 3 do pedido do Rodrigo (Reformulação do Planejamento de Estoque, 2026-11-23) — este
// componente é hoje só o SHELL: cabeçalho + navegação por abas + roteamento pra uma das 5 abas
// (Visão Geral / Grade / Distribuição / Reposição e Compras / Decisões e Ações). Antes
// (produto-detalhe.tsx pré-reformulação, ver auditoria §1.2), este MESMO componente empilhava até
// 8 blocos verticalmente sem nenhuma divisão — essa é a mudança estrutural central da missão.
// Nenhum dado novo é buscado aqui: tudo já vem resolvido de page.tsx (mesmo padrão de antes), só a
// APRESENTAÇÃO foi reorganizada. "Manter seleção de produto e filtros ao navegar entre abas" é
// garantido por aba/produto/grupo/tamanho/busca/situacao/sort/dir viverem todos no searchParam,
// nunca em estado client.
export function ProdutoDetalhe({
  detalhe,
  linha,
  classificacao,
  grade,
  podeClassificar,
  fecharHref,
  excessoDistribuicao,
  decisoesMovimentacao,
  decisoesCompra,
  minimoManual,
  recomendacaoPrincipal,
  distribuicaoHref,
  basePath,
  searchParams,
}: {
  detalhe: ProdutoPlanejamentoDetalhe;
  linha: ProdutoPlanejamento | undefined;
  classificacao: ClassificacaoAgregada;
  grade: RecomendacaoGradeProduto | null;
  podeClassificar: boolean;
  fecharHref: string;
  excessoDistribuicao: ProdutoExcessoDistribuicao | null;
  decisoesMovimentacao: DecisoesMovimentacaoPorStatus | null;
  decisoesCompra: DecisaoCompra[];
  minimoManual: ItemMinimoManual[];
  recomendacaoPrincipal: RecomendacaoPrincipal | null;
  distribuicaoHref: string;
  basePath: string;
  searchParams: RawSearchParams;
}) {
  const aba: ProdutoAba = parseProdutoAba(searchParams.aba);

  return (
    <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between border-b border-[var(--gridline)] px-4 py-2.5">
        <h2 className="text-sm font-medium text-[var(--text-secondary)]">
          Detalhe — {detalhe.produto} <span className="text-[var(--text-muted)]">({detalhe.cods.length} SKU(s))</span>
        </h2>
        <a href={fecharHref} className="text-xs text-[var(--text-muted)] hover:underline">
          Fechar ✕
        </a>
      </div>

      <ProdutoAbaNav basePath={basePath} searchParams={searchParams} atual={aba} />

      {aba === "geral" && <AbaVisaoGeralProduto detalhe={detalhe} linha={linha} recomendacao={recomendacaoPrincipal} />}
      {aba === "grade" && <AbaGradeProduto detalhe={detalhe} grade={grade} />}
      {aba === "distribuicao" && <AbaDistribuicaoProduto excesso={excessoDistribuicao} distribuicaoHref={distribuicaoHref} />}
      {aba === "reposicao" && (
        <AbaReposicaoProduto detalhe={detalhe} excesso={excessoDistribuicao} minimoManual={minimoManual} podeEditarMinimo={podeClassificar} />
      )}
      {aba === "decisoes" && (
        <AbaDecisoesProduto
          detalhe={detalhe}
          classificacao={classificacao}
          podeClassificar={podeClassificar}
          decisoesMovimentacao={decisoesMovimentacao}
          decisoesCompra={decisoesCompra}
          distribuicaoHref={distribuicaoHref}
        />
      )}
    </div>
  );
}
