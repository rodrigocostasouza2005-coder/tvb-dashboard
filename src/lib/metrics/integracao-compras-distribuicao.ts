import { TipoCompraProduto } from "@prisma/client";
import {
  getComparacaoEntreLojas,
  getOportunidadesTransferencia,
  necessidadePorLoja,
  type ComparacaoVariante,
  type OportunidadeTransferencia,
} from "./distribuicao-estoque";
import {
  getClassificacaoPorProduto,
  getRecomendacoesBestSeller,
  getRecomendacoesDrop,
  agregarRecomendacaoProduto,
  type RecomendacaoAgregadaProduto,
  type RecomendacaoBestSellerPorProduto,
  type RecomendacaoDropPorProduto,
  type ClassificacaoPorProdutoEntry,
} from "./compras-inteligencia";

// ---------------------------------------------------------------------------
// INTEGRAÇÃO COMPRAS <-> DISTRIBUIÇÃO
// ---------------------------------------------------------------------------
// Pedido do Rodrigo em 2026-10-31 ("FASE DE VALIDAÇÃO OPERACIONAL E INTEGRAÇÃO DAS
// INTELIGÊNCIAS"): antes de recomendar compra nova, consultar se o estoque já existente na rede
// (nas lojas de varejo) resolve parte da necessidade via transferência.
//
// Decisão de modelagem importante, documentada aqui porque não é óbvia: a Inteligência de
// Compras (compras-inteligencia.ts) calcula "quanto comprar" olhando o estoque da REDE INTEIRA
// somado (nenhuma query ali filtra por loja) — ou seja, o "quantidadeSugerida" dela já desconta
// TODO estoque existente, onde quer que ele esteja. Transferir estoque entre lojas de varejo não
// cria unidade nova, então matematicamente não pode reduzir aquele número de rede.
//
// O que ESTA integração calcula é um número DIFERENTE e complementar: "necessidade identificada"
// aqui é a soma, loja a loja, de quanto cada loja de varejo especificamente precisa pra sair de
// ruptura/cobertura crítica (mesma fórmula que a Inteligência de Distribuição já usa pra decidir
// se vale transferir — ver necessidadePorLoja). Esse número reflete MISALOCAÇÃO (estoque parado
// numa loja enquanto outra desabastece), não escassez de rede. A "necessidade residual" (depois
// de descontar o que é resolvível por transferência) é o que sobra de necessidade REAL de loja
// que a rede, hoje, não consegue atender só reorganizando o que já tem.
//
// Por isso o painel mostra os DOIS números lado a lado — a sugestão independente da Inteligência
// de Compras (rede inteira, já validada, nunca sobrescrita por esta integração) e a necessidade
// residual por loja (este cálculo novo) — em vez de fingir que um substitui o outro. Nunca
// "mistura" BEST_SELLER com DROP: a classificação de cada produto decide sozinha se a recompra é
// permitida (ver bloqueadoRecompra/precisaConfirmacaoHumana abaixo), a integração nunca contorna
// essa regra.

export type RecomendacaoConsolidadaProduto = {
  produto: string;
  grupo: string;
  tipoCompra: TipoCompraProduto;
  cods: string[];
  // Soma, entre as 3 lojas de varejo e todos os SKUs (cor+tamanho) deste produto, de quanto cada
  // loja em ruptura/cobertura crítica precisa pra chegar na cobertura-alvo — ver necessidadePorLoja.
  necessidadeIdentificada: number;
  estoqueDisponivelNaRede: number;
  quantidadeTransferivel: number;
  necessidadeResidual: number;
  transferencias: OportunidadeTransferencia[];
  // Número independente da Inteligência de Compras pra este produto (rede inteira) — cross-check,
  // nunca sobrescrito por esta integração.
  sugestaoCompraIndependente: RecomendacaoAgregadaProduto | null;
  // null = decisão pendente de confirmação humana (Drop com possibilidadeReposicao A_CONFIRMAR);
  // 0 quando a recompra está bloqueada (Drop com possibilidadeReposicao NAO) — a necessidade
  // residual continua calculada e visível, só não vira sugestão de compra.
  compraFinalRecomendada: number | null;
  justificativa: string[];
};

export type ConsolidacaoFiltro = {
  grupoIn?: string[];
  colecaoIn?: string[];
  busca?: string;
  storeIdsPermitidas?: string[];
  horizonteDiasOverride?: number;
  coberturaAlvoDiasDistribuicao?: number;
};

const COBERTURA_ALVO_PADRAO_DIAS = 30;

// Monta a recomendação consolidada por produto. Resiliente de propósito (seção 4 do pedido:
// "falhas de uma inteligência não podem interromper a outra") — Distribuição e Compras são
// buscadas em paralelo com Promise.allSettled; se qualquer uma falhar, a função não lança erro
// pro chamador (a página de Mapa de Compras continua funcionando sem o painel complementar), só
// loga e devolve lista vazia (nunca inventa um número parcial/arriscado quando falta uma ponta).
export async function getRecomendacaoConsolidada(filtro: ConsolidacaoFiltro = {}): Promise<RecomendacaoConsolidadaProduto[]> {
  const coberturaAlvoDias = filtro.coberturaAlvoDiasDistribuicao ?? COBERTURA_ALVO_PADRAO_DIAS;
  const filtroComum = { grupoIn: filtro.grupoIn, colecaoIn: filtro.colecaoIn, busca: filtro.busca, storeIdsPermitidas: filtro.storeIdsPermitidas };

  const [distribuicaoResult, comprasResult] = await Promise.allSettled([
    Promise.all([getComparacaoEntreLojas(filtroComum), getOportunidadesTransferencia(filtroComum, coberturaAlvoDias)]),
    Promise.all([
      getClassificacaoPorProduto(),
      getRecomendacoesBestSeller({ grupoIn: filtro.grupoIn, colecaoIn: filtro.colecaoIn, horizonteDiasOverride: filtro.horizonteDiasOverride }),
      getRecomendacoesDrop({ grupoIn: filtro.grupoIn, colecaoIn: filtro.colecaoIn, horizonteDiasOverride: filtro.horizonteDiasOverride }),
    ]),
  ]);

  if (distribuicaoResult.status === "rejected") {
    console.error("[integracao-compras-distribuicao] Distribuição falhou:", distribuicaoResult.reason);
  }
  if (comprasResult.status === "rejected") {
    console.error("[integracao-compras-distribuicao] Compras falhou:", comprasResult.reason);
  }
  // Sem as duas pontas, não dá pra consolidar nada com segurança (a página de Mapa de Compras
  // continua mostrando sua matriz normal de qualquer forma — essa função só alimenta o painel
  // complementar, nunca é chamada no caminho crítico de carregamento da matriz).
  if (distribuicaoResult.status === "rejected" || comprasResult.status === "rejected") return [];

  const [comparacoes, oportunidades] = distribuicaoResult.value;
  const [classificacaoPorProduto, bsRows, dropRows] = comprasResult.value;
  const bsPorCod = new Map(bsRows.map((r) => [r.cod, r]));
  const dropPorCod = new Map(dropRows.map((r) => [r.cod, r]));

  return combinarRecomendacaoConsolidada(comparacoes, oportunidades, classificacaoPorProduto, bsPorCod, dropPorCod, coberturaAlvoDias);
}

// Pura, testável sem banco — recebe os dados já buscados pelas duas inteligências (nenhum
// Prisma/fetch aqui) e devolve a lista consolidada por produto. Separada de
// getRecomendacaoConsolidada de propósito: a camada de dados cuida de buscar+isolar falhas
// (Promise.allSettled), esta função só combina o que já chegou — mais fácil de testar cenário a
// cenário (transferível, mínimo preservado, residual, compatibilidade de SKU, BS vs. Drop) sem
// mockar Prisma.
export function combinarRecomendacaoConsolidada(
  comparacoes: ComparacaoVariante[],
  oportunidades: OportunidadeTransferencia[],
  classificacaoPorProduto: Map<string, ClassificacaoPorProdutoEntry>,
  bsPorCod: Map<string, RecomendacaoBestSellerPorProduto>,
  dropPorCod: Map<string, RecomendacaoDropPorProduto>,
  coberturaAlvoDias: number
): RecomendacaoConsolidadaProduto[] {
  // Agrupa por NOME de produto (mesmo grão da matriz de Compras/getMapaDeComprasDetalhado) —
  // cada "variante" já é um cod (SKU = cor+tamanho) comparado entre as 3 lojas de varejo, então
  // agrupar por produto aqui preserva a compatibilidade de SKU/cor/tamanho automaticamente: nunca
  // soma necessidade de um cod com a disponibilidade de outro cod diferente por engano, porque
  // cada `transferencias` só é anexada ao cod exato de onde ela veio (oportunidadesPorCod).
  const porProduto = new Map<string, ComparacaoVariante[]>();
  for (const c of comparacoes) {
    const arr = porProduto.get(c.produto) ?? [];
    arr.push(c);
    porProduto.set(c.produto, arr);
  }

  const oportunidadesPorCod = new Map<string, OportunidadeTransferencia[]>();
  for (const o of oportunidades) {
    const arr = oportunidadesPorCod.get(o.cod) ?? [];
    arr.push(o);
    oportunidadesPorCod.set(o.cod, arr);
  }

  const resultado: RecomendacaoConsolidadaProduto[] = [];
  for (const [produtoNome, variantes] of porProduto) {
    const grupo = variantes[0].grupo;
    const classificacao = classificacaoPorProduto.get(`${grupo}::${produtoNome}`);
    if (!classificacao) continue; // sem classificação -> fila de revisão, nunca aqui (mesma regra da matriz)

    let necessidadeIdentificada = 0;
    let estoqueDisponivelNaRede = 0;
    const transferencias: OportunidadeTransferencia[] = [];
    for (const v of variantes) {
      for (const loja of v.porLoja) {
        estoqueDisponivelNaRede += loja.estoqueAtual;
        necessidadeIdentificada += necessidadePorLoja(loja, coberturaAlvoDias);
      }
      // Cada oportunidade já respeita o mínimo de segurança da origem (ver
      // calcularOportunidadeTransferencia, distribuicao-estoque.ts) — essa integração não
      // recalcula isso, só soma o que a Distribuição já validou pra esse cod exato.
      transferencias.push(...(oportunidadesPorCod.get(v.cod) ?? []));
    }
    // Nenhuma evidência real pra este produto (nem necessidade, nem transferência) -> não entra
    // no painel (seção 5 do pedido: "não apresentar recomendações sem evidências suficientes").
    if (necessidadeIdentificada === 0 && transferencias.length === 0) continue;

    const quantidadeTransferivel = transferencias.reduce((s, t) => s + t.quantidadeSugerida, 0);
    const necessidadeResidual = Math.max(0, necessidadeIdentificada - quantidadeTransferivel);
    const sugestaoCompraIndependente = agregarRecomendacaoProduto(classificacao.tipoCompra, classificacao.cods, bsPorCod, dropPorCod);

    // "Não misturar BEST_SELLER e DROP": a integração nunca contorna o que a própria
    // classificação já decidiu — bloqueio e confirmação pendente do Drop valem igual aqui.
    let compraFinalRecomendada: number | null = necessidadeResidual;
    const justificativa: string[] = [];
    if (sugestaoCompraIndependente?.bloqueadoRecompra) {
      compraFinalRecomendada = 0;
      justificativa.push("Recompra bloqueada pela classificação Drop (possibilidade de reposição = Não) — necessidade residual é só informativa, não vira sugestão de compra.");
    } else if (sugestaoCompraIndependente?.precisaConfirmacaoHumana) {
      compraFinalRecomendada = null;
      justificativa.push("Possibilidade de reposição ainda não confirmada para este Drop — decisão de compra fica pendente de confirmação humana, mesmo com necessidade residual calculada.");
    }

    if (transferencias.length > 0) {
      justificativa.push(`${transferencias.length} transferência(s) identificada(s), cobrindo ${quantidadeTransferivel} de ${necessidadeIdentificada} un. de necessidade nas lojas.`);
    } else {
      justificativa.push("Necessidade identificada nas lojas, mas nenhuma outra loja tem sobra real para transferir — toda a necessidade vira residual.");
    }
    if (sugestaoCompraIndependente) {
      justificativa.push(
        `Para comparação: a Inteligência de Compras (rede inteira, cálculo independente) sugere ${sugestaoCompraIndependente.quantidadeSugerida} un. — os dois números medem coisas diferentes (ver nota técnica do painel).`
      );
    }

    resultado.push({
      produto: produtoNome,
      grupo,
      tipoCompra: classificacao.tipoCompra,
      cods: classificacao.cods,
      necessidadeIdentificada,
      estoqueDisponivelNaRede,
      quantidadeTransferivel,
      necessidadeResidual,
      transferencias,
      sugestaoCompraIndependente,
      compraFinalRecomendada,
      justificativa,
    });
  }

  return resultado.sort((a, b) => b.necessidadeResidual - a.necessidadeResidual);
}
