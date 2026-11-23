import type { Diagnostico } from "./distribuicao-estoque";
import type { ClassificacaoAgregada } from "./planejamento-estoque";
import type { ProdutoExcessoDistribuicao } from "./planejamento-distribuicao";
import type { RecomendacaoBestSellerPorProduto, RecomendacaoDropPorProduto } from "./compras-inteligencia";

// ---------------------------------------------------------------------------
// SÍNTESE DA RECOMENDAÇÃO PRINCIPAL — Reformulação do Planejamento de Estoque (2026-11-23)
// ---------------------------------------------------------------------------
// Pedido do Rodrigo (Zona 3 / Aba 1 "Visão Geral do produto"): "recomendação principal destacada
// COM justificativa", respeitando a ordem lógica demanda → estoque disponível → distribuição entre
// unidades → possibilidade de redistribuição → trânsito/compras já feitas → necessidade de
// reposição → recomendação final — e, acima de tudo, "nunca recomendar comprar quando
// redistribuição resolveria".
//
// Esta função NÃO calcula nada novo — é uma camada de SÍNTESE/PRIORIZAÇÃO, 100% pura (sem
// Prisma, testável com dado sintético), sobre resultados que os motores já maduros do Radar já
// calcularam: `situacao`/`classificacao` (planejamento-estoque.ts, que por sua vez reaproveita
// diagnosticarVariante), `excesso` (planejamento-distribuicao.ts/getProdutoExcessoDistribuicao,
// que reaproveita o motor de distribuição já em produção) e as recomendações de compra por SKU
// (compras-inteligencia.ts). Nenhuma quantidade é inventada aqui — a justificativa é sempre
// montada citando os números REAIS desses objetos (premissas/avisos originais, quantidades
// sugeridas, contagens), nunca um texto fixo desacoplado do produto.
export type TipoRecomendacaoPrincipal =
  | "comprar"
  | "transferir"
  | "aguardar"
  | "reduzir_exposicao"
  | "revisar_classificacao"
  | "sem_necessidade"
  | "sem_dado_suficiente";

export type RecomendacaoPrincipal = {
  tipo: TipoRecomendacaoPrincipal;
  titulo: string;
  // Sempre pelo menos 1 item, sempre citando dado real (número, nome de posição, premissa do
  // motor) — nunca uma frase genérica sem relação com o produto em questão.
  justificativa: string[];
};

export type InputRecomendacaoPrincipal = {
  situacao: Diagnostico;
  classificacao: ClassificacaoAgregada;
  demandaPossivelmenteMascarada: boolean;
  excesso: ProdutoExcessoDistribuicao | null;
  recomendacoesBestSeller: RecomendacaoBestSellerPorProduto[];
  recomendacoesDrop: RecomendacaoDropPorProduto[];
};

function formatN(v: number): string {
  return v.toLocaleString("pt-BR");
}

export function sintetizarRecomendacaoPrincipal(input: InputRecomendacaoPrincipal): RecomendacaoPrincipal {
  // 1) Falta de dado vem antes de tudo — nunca finge ter base pra recomendar o que quer que seja.
  if (input.situacao === "sem_dado") {
    return {
      tipo: "sem_dado_suficiente",
      titulo: "Dados insuficientes para recomendar",
      justificativa: [
        "Sem estoque e sem venda registrada para este produto nos últimos 90 dias — não há base real para avaliar demanda ou decidir uma ação.",
      ],
    };
  }

  // 2) Lançamento recente (correção da regra de estoque parado, ver distribuicao-estoque.ts):
  // estoque presente, zero venda, mas ainda sem janela suficiente pra julgar — nunca tratado como
  // parado nem como excesso.
  if (input.situacao === "lancamento_recente") {
    return {
      tipo: "aguardar",
      titulo: "Aguardar — estoque recém-chegado, ainda sem janela de venda",
      justificativa: [
        "Há estoque disponível e nenhuma venda registrada nos últimos 90 dias, mas a produção mais antiga conhecida deste SKU também está dentro dessa mesma janela — o produto ainda não teve tempo de vitrine suficiente pra que a ausência de venda signifique falta de demanda.",
        "Reavaliar depois de mais alguns dias/semanas de giro, antes de qualquer decisão de compra, transferência ou redução de exposição.",
      ],
    };
  }

  const temRupturaOuCritico = input.situacao === "ruptura" || input.situacao === "cobertura_critica";

  if (temRupturaOuCritico) {
    const nomeSituacao = input.situacao === "ruptura" ? "Ruptura" : "Cobertura crítica";
    const oportunidades = input.excesso?.oportunidades ?? [];
    // 3) Distribuição entre unidades / possibilidade de redistribuição vem ANTES de compra — "nunca
    // recomendar comprar quando redistribuição resolveria" (pedido explícito do Rodrigo).
    if ((input.excesso?.rupturaComExcessoDisponivel ?? false) && oportunidades.length > 0) {
      const totalSugerido = oportunidades.reduce((s, o) => s + o.quantidadeSugerida, 0);
      const justificativa = [
        `${nomeSituacao} identificada em pelo menos uma unidade, mas o motor de distribuição já encontrou ${formatN(totalSugerido)} unidade(s) disponível(is) em outra posição deste mesmo produto.`,
        "Redistribuir resolve sem comprar — ver aba Distribuição para as oportunidades específicas (origem/destino/quantidade já calculados).",
      ];
      if (input.demandaPossivelmenteMascarada) {
        justificativa.push(
          "Atenção: a venda observada pode estar subestimando a demanda real nesta unidade por causa do próprio estoque crítico/zerado — não é necessariamente falta de interesse."
        );
      }
      return { tipo: "transferir", titulo: "Transferir antes de comprar", justificativa };
    }

    // 4) Trânsito/compras já feitas e necessidade de reposição — só chega aqui quando
    // redistribuição NÃO resolve.
    const recBS = input.recomendacoesBestSeller[0];
    if (recBS && recBS.quantidadeSugerida > 0) {
      const justificativa = [
        `Motor de compras (Best Seller) sugere ${formatN(recBS.quantidadeSugerida)} unidade(s)${
          recBS.valorEstimado != null ? ` (≈ R$ ${recBS.valorEstimado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })})` : ""
        } — confiança ${recBS.confiavel ? "alta" : "baixa"}.`,
        ...recBS.premissas,
        ...recBS.avisos,
      ];
      if (!input.excesso || (input.excesso.excessoCD === 0 && input.excesso.excessoLojas === 0)) {
        justificativa.push("Nenhum excesso disponível identificado em outra posição deste produto — compra é a alternativa coerente com o dado atual, não uma omissão da checagem de redistribuição.");
      }
      if (input.demandaPossivelmenteMascarada) {
        justificativa.push("A venda observada pode estar subestimando a demanda real devido ao próprio estoque crítico/zerado.");
      }
      return { tipo: "comprar", titulo: "Comprar", justificativa };
    }

    const recDrop = input.recomendacoesDrop[0];
    if (recDrop) {
      if (recDrop.riscoRuptura && recDrop.quantidadeSugerida != null && recDrop.quantidadeSugerida > 0) {
        return {
          tipo: "comprar",
          titulo: "Comprar (Drop, risco de ruptura dentro da janela comercial)",
          justificativa: [
            `Drop com risco de ruptura identificado — motor sugere ${formatN(recDrop.quantidadeSugerida)} unidade(s) dentro da janela comercial restante.`,
            ...recDrop.premissas,
            ...recDrop.avisos,
          ],
        };
      }
      if (recDrop.precisaConfirmacaoHumana) {
        return {
          tipo: "revisar_classificacao",
          titulo: "Confirmar possibilidade de reposição do Drop",
          justificativa: [
            `${nomeSituacao} identificada, mas a possibilidade de reposição deste Drop ainda está marcada como "A confirmar" — nenhuma quantidade é sugerida até decisão humana.`,
            ...recDrop.avisos,
          ],
        };
      }
      if (recDrop.bloqueadoRecompra) {
        return {
          tipo: "sem_necessidade",
          titulo: "Ruptura sem recompra autorizada",
          justificativa: [
            `${nomeSituacao} identificada, mas a reposição deste Drop está marcada como NÃO permitida — recomendação automática de recompra bloqueada por decisão já registrada.`,
            ...recDrop.avisos,
          ],
        };
      }
    }

    if (input.classificacao === "NAO_CLASSIFICADO" || input.classificacao === "MISTO") {
      return {
        tipo: "revisar_classificacao",
        titulo: "Classificar produto para calcular recomendação de compra",
        justificativa: [
          `${nomeSituacao} identificada, mas o produto não está classificado Best Seller/Drop (${
            input.classificacao === "MISTO" ? "SKUs com classificações diferentes" : "nenhum SKU classificado"
          }) — sem isso o motor de compras não calcula quantidade sugerida.`,
          "Classifique o produto na aba Decisões e Ações para habilitar a recomendação automática.",
        ],
      };
    }

    return {
      tipo: "revisar_classificacao",
      titulo: "Revisar — sem quantidade sugerida calculável",
      justificativa: [
        `${nomeSituacao} identificada, mas o motor de compras não retornou uma quantidade sugerida positiva com os dados disponíveis hoje — ver aba Reposição e Compras para o detalhe e os avisos específicos.`,
      ],
    };
  }

  // 5) Excesso / sem movimentação — nunca sugere compra; prioriza redistribuição, depois retenção
  // já justificada pelo motor, só então reduzir exposição.
  if (input.situacao === "cobertura_excessiva" || input.situacao === "estoque_parado") {
    const nomeSituacao = input.situacao === "estoque_parado" ? "Estoque sem movimentação em 90 dias" : "Cobertura acima do limiar de excesso";
    const protegido = (input.excesso?.dropsCicloAtivoProtegidos ?? 0) > 0 || (input.excesso?.reservaContinuidadeBestSeller ?? 0) > 0;
    if (protegido) {
      return {
        tipo: "aguardar",
        titulo: "Aguardar — excesso aparente já tem retenção justificada",
        justificativa: [
          "O motor de distribuição já identificou e reteve parte deste estoque (Drop em ciclo ativo e/ou reserva de continuidade de Best Seller) — aparenta excesso, mas há justificativa comercial pra não mover agora.",
        ],
      };
    }

    const oportunidades = input.excesso?.oportunidades ?? [];
    if (oportunidades.length > 0) {
      const totalSugerido = oportunidades.reduce((s, o) => s + o.quantidadeSugerida, 0);
      return {
        tipo: "transferir",
        titulo: "Transferir para onde há demanda",
        justificativa: [
          `${nomeSituacao}, e o motor de distribuição já encontrou necessidade real em outra unidade deste produto — ${formatN(totalSugerido)} unidade(s) com oportunidade de transferência calculada.`,
          "Ver aba Distribuição para origem/destino/quantidade.",
        ],
      };
    }

    return {
      tipo: "reduzir_exposicao",
      titulo: "Reduzir exposição",
      justificativa: [
        `${nomeSituacao}, sem necessidade identificada em nenhuma outra unidade deste produto hoje.`,
        "Considere reduzir exposição (promoção, liquidação) em vez de manter capital parado — comprar mais deste produto agora não é recomendado.",
      ],
    };
  }

  // 6) Equilibrado — nenhuma ação.
  return {
    tipo: "sem_necessidade",
    titulo: "Sem ação necessária",
    justificativa: ["Estoque equilibrado em relação à venda observada — nenhuma ação de compra, transferência ou redução de exposição é recomendada agora."],
  };
}
