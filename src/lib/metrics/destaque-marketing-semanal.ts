import { prisma } from "@/lib/prisma";
import { cacheAsync, HEAVY_QUERY_CACHE_MS } from "./core";
import { getProdutosPlanejamento, type Tendencia } from "./planejamento-estoque";
import { getSellthroughColecaoDetalhe } from "./sellthrough";
import { COLECAO_BEST_SELLER } from "./reposicao-bestseller-consolidada";
import type { ComparacaoFiltro, Diagnostico } from "./distribuicao-estoque";

// ---------------------------------------------------------------------------
// DESTAQUE DE MARKETING SEMANAL (pedido do Rodrigo, 2026-11-24)
// ---------------------------------------------------------------------------
// Pergunta: "quais produtos merecem destaque em marketing/criativo/stories essa semana?" — PRIMEIRA
// metade de um agente semanal (a segunda metade, a rotina/cron que de fato envia o aviso, é feita
// depois, fora deste arquivo). Este módulo só calcula a lista + justificativa; nunca agenda nada.
//
// 4 critérios confirmados pelo Rodrigo (um produto pode bater em mais de um — isso É o sinal mais
// forte, não um empate a desfazer). Nenhum dos 4 é cálculo novo: todos reaproveitam sinais que já
// existem e já são usados em produção em outras telas do Radar. Ver cada critério abaixo.
//
// AGREGAÇÃO POR PRODUTO (não por cod): decisão de marketing é sobre a peça, não sobre uma
// combinação de cor/tamanho isolada — mesmo nível de agregação que getProdutosPlanejamento já usa
// em Planejamento de Estoque (não um conceito novo, reexposto aqui). Quando cods do mesmo produto
// têm diagnóstico divergente entre si (ex: uma cor com excesso, outra equilibrada), o Rodrigo NÃO
// decide por "o pior cod" nem por "a maioria dos cods": getProdutosPlanejamento já resolve isso
// somando estoque/venda de TODOS os cods do produto e diagnosticando o AGREGADO uma única vez
// (nunca diagnostica cod a cod e depois escolhe um) — este módulo herda esse mesmo comportamento
// sem reimplementar nada.

export type CriterioDestaqueMarketing =
  | "lancamento_recente"
  | "best_seller_em_alta"
  | "baixo_sell_through"
  | "excesso_estoque";

export type ProdutoDestaqueMarketing = {
  produto: string;
  grupo: string;
  cods: string[];
  criterios: CriterioDestaqueMarketing[];
  // true quando 2+ critérios bateram pro mesmo produto — sinal mais forte pra priorizar na pauta
  // da semana, não um produto "melhor" que outro dentro do mesmo critério.
  sinalForte: boolean;
  // 1 frase por critério batido, com número real (nunca um rótulo genérico tipo "estoque alto").
  justificativas: string[];
  metricas: {
    estoqueTotal: number;
    coberturaDias: number | null;
    vendasDias30: number;
    vendasDias60: number;
    vendasDias90: number;
    sellThroughRate: number | null;
    isBestSeller: boolean;
    tendencia: Tendencia;
    situacao: Diagnostico;
  };
};

// Limiar de "baixo sell-through": reaproveita o MESMO corte de 30% já usado como "Crítico" na tela
// de Pesquisa (statusFor em src/app/dashboard/status-filter.tsx e pesquisa-table.tsx) — não é um
// número novo inventado aqui, é o limiar que o Rodrigo já vê pra essa métrica hoje em produção.
export const LIMIAR_SELLTHROUGH_BAIXO = 30;

// Limiar de cobertura "excessiva" usado no AGREGADO por produto — mesmo valor que
// diagnosticarVariante(..., "loja", ...) usa (distribuicao-estoque.ts: COBERTURA_EXCESSIVA_DIAS),
// que é o limiar que getProdutosPlanejamento de fato aplica pra decidir "situacao" no agregado por
// produto (sempre tipoPosicao="loja" lá, nunca "cd_site" — ver comentário em planejamento-estoque.ts).
// Repetido aqui só pra montar a justificativa em "quantas vezes o limiar" sem importar uma
// constante não-exportada; o cálculo de "excesso" em si continua vindo de `situacao`, nunca
// recalculado por este número.
const COBERTURA_EXCESSIVA_DIAS_AGREGADO = 60;

// ---------------------------------------------------------------------------
// NÚCLEO PURO (testável sem Prisma) — combina os 4 sinais já calculados pela camada de dados.
// Nenhuma query aqui, mesma separação pura/dados de distribuicao-estoque.ts e
// planejamento-estoque.ts.
// ---------------------------------------------------------------------------
export function avaliarCriteriosDestaque(input: {
  situacao: Diagnostico;
  tendencia: Tendencia;
  isBestSeller: boolean;
  sellThroughRate: number | null;
  // Vendido histórico (empresa toda) que alimentou o sellThroughRate — guard de "sem dado": vendido
  // = 0 no denominador do sell-through NÃO é "0% de sell-through" (mesmo bug já corrigido em
  // resolveSellThrough, estoque.ts: ausência de histórico, não sell-through ruim). Sem este guard,
  // qualquer produto recém-lançado sem venda ainda cairia aqui também, duplicando o sinal de
  // "lancamento_recente" com uma leitura enganosa de sell-through.
  vendidoParaSellThrough: number;
  coberturaDias: number | null;
  estoqueTotal: number;
  vendasDias30: number;
  vendasDias60: number;
}): { criterios: CriterioDestaqueMarketing[]; justificativas: string[] } {
  const criterios: CriterioDestaqueMarketing[] = [];
  const justificativas: string[] = [];

  // --- Critério 1: Lançamento recente --------------------------------------
  // Reaproveita 100% a mesma classificação de distribuicao-estoque.ts (via getProdutosPlanejamento,
  // que já chama diagnosticarVariante/calcularRecemLancado no agregado por produto) — nenhum
  // cálculo próprio de "o que é recente" neste arquivo.
  if (input.situacao === "lancamento_recente") {
    criterios.push("lancamento_recente");
    justificativas.push(
      `Lançamento recente: ${input.estoqueTotal} un. em estoque e nenhuma venda registrada ainda — dentro da janela usada por calcularRecemLancado (distribuicao-estoque.ts) desde a primeira produção finalizada.`
    );
  }

  // --- Critério 2: Best Seller em alta --------------------------------------
  // "Best Seller" = colecao-"BESTSELLER" (fonte real, ver COLECAO_BEST_SELLER em
  // reposicao-bestseller-consolidada.ts — NUNCA ClassificacaoProduto, processo manual nunca
  // operacionalizado). "Em alta" = tendencia (planejamento-estoque.ts: calcularTendencia), que já
  // existe e já compara vendasDias30 contra a janela de 30 dias ANTERIOR equivalente
  // (vendasDias60-vendasDias30), com 20% de margem antes de marcar crescimento — reaproveitado
  // tal como está, nenhuma nova noção de tendência inventada aqui.
  if (input.isBestSeller && input.tendencia === "crescimento") {
    criterios.push("best_seller_em_alta");
    const anterior = input.vendasDias60 - input.vendasDias30;
    justificativas.push(
      anterior > 0
        ? `Best Seller em alta: ${input.vendasDias30} un. vendidas nos últimos 30 dias vs. ${anterior} un. no período equivalente anterior — crescimento real, coleção BESTSELLER.`
        : `Best Seller em alta: ${input.vendasDias30} un. vendidas nos últimos 30 dias, sem nenhuma venda no período equivalente anterior — coleção BESTSELLER engatando.`
    );
  }

  // --- Critério 3: Baixo sell-through ----------------------------------------
  // Reaproveita getSellthroughColecaoDetalhe (sellthrough.ts) — nenhum recálculo de sell-through
  // aqui. "Ainda dentro da janela de vida útil da coleção": StatusComercialProduto/
  // dataEncerramentoPrevista (ClassificacaoProduto) existem pra isso, mas cobertura real no Neon é
  // baixíssima (achado da reformulação de Planejamento de Estoque, 2026-11-23) — não confiável
  // como sinal único. Por isso este critério usa SÓ o sell-through baixo em si, sem tentar inferir
  // "ainda está na janela de vida" a partir de um campo que quase nenhum produto tem preenchido.
  if (
    input.vendidoParaSellThrough > 0 &&
    input.sellThroughRate != null &&
    input.sellThroughRate < LIMIAR_SELLTHROUGH_BAIXO
  ) {
    criterios.push("baixo_sell_through");
    justificativas.push(
      `Sell-through de ${input.sellThroughRate.toFixed(1)}%, abaixo do limiar de ${LIMIAR_SELLTHROUGH_BAIXO}% já usado como "Crítico" na tela de Pesquisa — risco de encalhar.`
    );
  }

  // --- Critério 4: Excesso de estoque ----------------------------------------
  // Reaproveita 100% o estado "cobertura_excessiva" de diagnosticarVariante (distribuicao-estoque.ts),
  // já calculado no agregado por produto por getProdutosPlanejamento.
  if (input.situacao === "cobertura_excessiva") {
    criterios.push("excesso_estoque");
    const vezes =
      input.coberturaDias != null ? Math.round((input.coberturaDias / COBERTURA_EXCESSIVA_DIAS_AGREGADO) * 10) / 10 : null;
    justificativas.push(
      `Excesso de estoque: cobertura de ${input.coberturaDias} dia(s)${
        vezes != null ? `, ${vezes}x o limiar de excesso (${COBERTURA_EXCESSIVA_DIAS_AGREGADO} dias)` : ""
      }.`
    );
  }

  return { criterios, justificativas };
}

// ---------------------------------------------------------------------------
// CAMADA DE DADOS
// ---------------------------------------------------------------------------

export type DestaqueMarketingSemanalFiltro = Pick<ComparacaoFiltro, "grupoIn" | "colecaoIn" | "storeIdsPermitidas">;

export async function getDestaqueMarketingSemanal(
  filtro: DestaqueMarketingSemanalFiltro = {}
): Promise<ProdutoDestaqueMarketing[]> {
  return cacheAsync(`destaque-marketing-semanal:${JSON.stringify(filtro)}`, HEAVY_QUERY_CACHE_MS, () =>
    getDestaqueMarketingSemanalSemCache(filtro)
  );
}

async function getDestaqueMarketingSemanalSemCache(
  filtro: DestaqueMarketingSemanalFiltro
): Promise<ProdutoDestaqueMarketing[]> {
  const [produtos, sellthroughDetalhe, bestSellerRows] = await Promise.all([
    // Já dá, por produto: situacao (Diagnostico, inclui lancamento_recente/cobertura_excessiva),
    // tendencia (crescimento/estável/desaceleração/sem_dado), grupo, cods, estoqueTotal,
    // coberturaDias, vendasDias30/60/90 — nenhum desses é recalculado neste arquivo.
    getProdutosPlanejamento({
      grupoIn: filtro.grupoIn,
      colecaoIn: filtro.colecaoIn,
      storeIdsPermitidas: filtro.storeIdsPermitidas,
    }),
    // Sell-through real por grupo+produto (mesma granularidade de getProdutosPlanejamento) — sem
    // filtro de coleção aqui de propósito: queremos o sell-through de QUALQUER produto candidato,
    // não só de uma coleção específica.
    getSellthroughColecaoDetalhe({ grupoIn: filtro.grupoIn }),
    // Mesma fonte de "Best Seller" de reposicao-bestseller-consolidada.ts: qualquer posição com
    // colecao=BESTSELLER já qualifica o produto inteiro (colecao pode divergir entre posições do
    // mesmo produto por ruído de sync — nunca usado pra desqualificar).
    prisma.stockSnapshot.findMany({
      where: { colecao: COLECAO_BEST_SELLER },
      select: { produto: true },
      distinct: ["produto"],
    }),
  ]);

  if (produtos.length === 0) return [];

  const bestSellerSet = new Set(bestSellerRows.map((r) => r.produto));
  const sellthroughByKey = new Map(sellthroughDetalhe.map((r) => [`${r.grupo}\x00${r.produto}`, r]));

  const resultado: ProdutoDestaqueMarketing[] = [];
  for (const p of produtos) {
    const st = sellthroughByKey.get(`${p.grupo}\x00${p.produto}`);
    const isBestSeller = bestSellerSet.has(p.produto);
    const sellThroughRate = st?.sellThroughRate ?? null;

    const { criterios, justificativas } = avaliarCriteriosDestaque({
      situacao: p.situacao,
      tendencia: p.tendencia,
      isBestSeller,
      sellThroughRate,
      vendidoParaSellThrough: st?.vendido ?? 0,
      coberturaDias: p.coberturaDias,
      estoqueTotal: p.estoqueTotal,
      vendasDias30: p.vendasDias30,
      vendasDias60: p.vendasDias60,
    });

    if (criterios.length === 0) continue;

    resultado.push({
      produto: p.produto,
      grupo: p.grupo,
      cods: p.cods,
      criterios,
      sinalForte: criterios.length >= 2,
      justificativas,
      metricas: {
        estoqueTotal: p.estoqueTotal,
        coberturaDias: p.coberturaDias,
        vendasDias30: p.vendasDias30,
        vendasDias60: p.vendasDias60,
        vendasDias90: p.vendasDias90,
        sellThroughRate,
        isBestSeller,
        tendencia: p.tendencia,
        situacao: p.situacao,
      },
    });
  }

  // Sinal mais forte (mais critérios) primeiro; dentro do mesmo número de critérios, ordem
  // alfabética (determinístico, não depende de qual produto "pesa" mais em nenhuma métrica).
  return resultado.sort(
    (a, b) => b.criterios.length - a.criterios.length || a.produto.localeCompare(b.produto, "pt-BR")
  );
}
