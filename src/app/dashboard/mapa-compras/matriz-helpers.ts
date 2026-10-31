import type {
  MapaComprasGrupo,
  MapaComprasProduto,
  MesMapaCompras,
  RecomendacaoBestSellerPorProduto,
  RecomendacaoDropPorProduto,
  ClassificacaoPorProdutoEntry,
  RecomendacaoAgregadaProduto,
} from "@/lib/metrics";
import { somarSeriesMapaCompras, agregarRecomendacaoProduto } from "@/lib/metrics";
import { TipoCompraProduto } from "@prisma/client";

export type { RecomendacaoAgregadaProduto };

export type ProdutoMatriz = MapaComprasProduto & {
  cods: string[];
  divergente: boolean;
  recomendacao: RecomendacaoAgregadaProduto | null;
};

export type GrupoMatriz = {
  grupo: string;
  coberturaMeses: number;
  meses: MesMapaCompras[];
  produtos: ProdutoMatriz[];
};

// Pura: recebe os dados já buscados (grade mensal por grupo/produto + classificação por produto
// + recomendações já calculadas pela Inteligência de Compras, indexadas por cod) e devolve as
// DUAS matrizes separadas (Best Seller / Drop) que a tela mostra. A agregação por produto em si
// (agregarRecomendacaoProduto) foi promovida pra lib/metrics em 2026-10-31 — reaproveitada aqui
// e pela camada de integração com Distribuição, não duplicada.
export function particionarMatrizCompras(
  grupos: MapaComprasGrupo[],
  classificacaoPorProduto: Map<string, ClassificacaoPorProdutoEntry>,
  bsPorCod: Map<string, RecomendacaoBestSellerPorProduto>,
  dropPorCod: Map<string, RecomendacaoDropPorProduto>,
  todosMeses: string[]
): { bestSeller: GrupoMatriz[]; drop: GrupoMatriz[] } {
  const bestSeller: GrupoMatriz[] = [];
  const drop: GrupoMatriz[] = [];

  for (const grupo of grupos) {
    const produtosBS: ProdutoMatriz[] = [];
    const produtosDrop: ProdutoMatriz[] = [];

    for (const produto of grupo.produtos) {
      const classificacao = classificacaoPorProduto.get(`${grupo.grupo}::${produto.produto}`);
      if (!classificacao) continue; // sem classificação -> fila de revisão, nunca aqui

      const entry: ProdutoMatriz = {
        ...produto,
        cods: classificacao.cods,
        divergente: classificacao.divergente,
        recomendacao: agregarRecomendacaoProduto(classificacao.tipoCompra, classificacao.cods, bsPorCod, dropPorCod),
      };

      if (classificacao.tipoCompra === TipoCompraProduto.BEST_SELLER) produtosBS.push(entry);
      else produtosDrop.push(entry);
    }

    if (produtosBS.length > 0) {
      bestSeller.push({
        grupo: grupo.grupo,
        coberturaMeses: grupo.coberturaMeses,
        meses: somarSeriesMapaCompras(produtosBS.map((p) => p.meses), todosMeses),
        produtos: produtosBS,
      });
    }
    if (produtosDrop.length > 0) {
      drop.push({
        grupo: grupo.grupo,
        coberturaMeses: grupo.coberturaMeses,
        meses: somarSeriesMapaCompras(produtosDrop.map((p) => p.meses), todosMeses),
        produtos: produtosDrop,
      });
    }
  }

  return { bestSeller, drop };
}
