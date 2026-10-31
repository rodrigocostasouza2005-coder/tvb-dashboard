import type {
  MapaComprasGrupo,
  MapaComprasProduto,
  MesMapaCompras,
  RecomendacaoBestSellerPorProduto,
  RecomendacaoDropPorProduto,
  ClassificacaoPorProdutoEntry,
} from "@/lib/metrics";
import { somarSeriesMapaCompras } from "@/lib/metrics";
import { TipoCompraProduto } from "@prisma/client";

export type RecomendacaoAgregadaProduto = {
  quantidadeSugerida: number;
  valorEstimado: number | null;
  // Só preenchido quando o produto tem um único SKU/tamanho classificado — média de "dias de
  // cobertura" entre tamanhos diferentes do mesmo produto não é um número que faça sentido
  // mostrar como se fosse preciso.
  coberturaAtualDias: number | null;
  confiavel: boolean;
  sellThroughAtual: number | null; // só Drop
  riscoRuptura: boolean;
  riscoSobra: boolean;
  bloqueadoRecompra: boolean;
  precisaConfirmacaoHumana: boolean;
  premissas: string[];
  avisos: string[];
};

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

function agregarPremissas(rows: { premissas: string[]; avisos: string[] }[]): { premissas: string[]; avisos: string[] } {
  return {
    premissas: [...new Set(rows.flatMap((r) => r.premissas))],
    avisos: [...new Set(rows.flatMap((r) => r.avisos))],
  };
}

function agregarBestSeller(rows: RecomendacaoBestSellerPorProduto[]): RecomendacaoAgregadaProduto | null {
  if (rows.length === 0) return null;
  const { premissas, avisos } = agregarPremissas(rows);
  return {
    quantidadeSugerida: rows.reduce((s, r) => s + r.quantidadeSugerida, 0),
    valorEstimado: rows.some((r) => r.valorEstimado != null) ? rows.reduce((s, r) => s + (r.valorEstimado ?? 0), 0) : null,
    coberturaAtualDias: rows.length === 1 ? rows[0].coberturaAtualDias : null,
    confiavel: rows.every((r) => r.confiavel),
    sellThroughAtual: null,
    riscoRuptura: rows.some((r) => r.coberturaAtualDias != null && r.coberturaAtualDias < 7 && r.quantidadeSugerida > 0),
    riscoSobra: false,
    bloqueadoRecompra: false,
    precisaConfirmacaoHumana: false,
    premissas,
    avisos,
  };
}

function agregarDrop(rows: RecomendacaoDropPorProduto[]): RecomendacaoAgregadaProduto | null {
  if (rows.length === 0) return null;
  const { premissas, avisos } = agregarPremissas(rows);
  const comVendas = rows.filter((r) => r.sellThroughAtual != null);
  // Média simples do sell-through entre os tamanhos/cods com dado (SugestaoDrop não expõe
  // vendasAcumuladas por fora pra ponderar por volume) — aviso explícito de que é aproximado
  // quando o produto tem mais de 1 SKU.
  const sellThroughAtual = comVendas.length > 0 ? comVendas.reduce((s, r) => s + r.sellThroughAtual!, 0) / comVendas.length : null;
  if (comVendas.length > 1) {
    avisos.push("Sell-through exibido é a média simples entre os tamanhos/SKUs deste produto (não ponderada por volume).");
  }
  return {
    quantidadeSugerida: rows.reduce((s, r) => s + (r.quantidadeSugerida ?? 0), 0),
    valorEstimado: rows.some((r) => r.valorEstimado != null) ? rows.reduce((s, r) => s + (r.valorEstimado ?? 0), 0) : null,
    coberturaAtualDias: null,
    confiavel: true,
    sellThroughAtual,
    riscoRuptura: rows.some((r) => r.riscoRuptura),
    riscoSobra: rows.some((r) => r.riscoSobra),
    bloqueadoRecompra: rows.some((r) => r.bloqueadoRecompra),
    precisaConfirmacaoHumana: rows.some((r) => r.precisaConfirmacaoHumana),
    premissas,
    avisos,
  };
}

// Pura: recebe os dados já buscados (grade mensal por grupo/produto + classificação por produto
// + recomendações já calculadas pela Inteligência de Compras, indexadas por cod) e devolve as
// DUAS matrizes separadas (Best Seller / Drop) que a tela mostra. Nenhuma chamada a banco aqui —
// testável sem mock de Prisma, só não tem teste dedicado nesta entrega (ver plano: coberto pela
// validação manual via dev+curl, por ser composição de dado já testado nas camadas de baixo).
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

      const bsRows = classificacao.cods.map((c) => bsPorCod.get(c)).filter((r): r is RecomendacaoBestSellerPorProduto => !!r);
      const dropRows = classificacao.cods.map((c) => dropPorCod.get(c)).filter((r): r is RecomendacaoDropPorProduto => !!r);

      const entry: ProdutoMatriz = {
        ...produto,
        cods: classificacao.cods,
        divergente: classificacao.divergente,
        recomendacao:
          classificacao.tipoCompra === TipoCompraProduto.BEST_SELLER ? agregarBestSeller(bsRows) : agregarDrop(dropRows),
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
