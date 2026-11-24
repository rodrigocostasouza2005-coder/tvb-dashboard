import { describe, it, expect } from "vitest";
import {
  sintetizarRecomendacaoPrincipal,
  type InputRecomendacaoPrincipal,
} from "../planejamento-recomendacao";
import type { ProdutoExcessoDistribuicao } from "../planejamento-distribuicao";
import type { MovimentacaoRecomendada } from "../distribuicao-estoque";
import type { RecomendacaoBestSellerPorProduto, RecomendacaoDropPorProduto } from "../compras-inteligencia";

// sintetizarRecomendacaoPrincipal é pura — testada aqui com objetos sintéticos que respeitam a
// mesma forma dos tipos reais já produzidos pelos motores existentes (planejamento-distribuicao.ts,
// compras-inteligencia.ts), nunca uma forma simplificada que não existiria em produção.

function oportunidade(overrides: Partial<MovimentacaoRecomendada> = {}): MovimentacaoRecomendada {
  return {
    cod: "COD-1",
    produto: "Classic Black",
    grupo: "Camisetas",
    cor: "Preto",
    tamanho: "M",
    tipoMovimentacao: "loja_loja",
    classificacao: "REDISTRIBUIR",
    prioridade: "alta",
    confianca: "alta",
    origemPosicaoId: "loja-a",
    origemNome: "Loja A",
    destinoPosicaoId: "loja-b",
    destinoNome: "Loja B",
    quantidadeSugerida: 10,
    estoqueOrigemAntes: 20,
    estoqueOrigemDepois: 10,
    estoqueDestinoAntes: 0,
    estoqueDestinoDepois: 10,
    disponivelOrigem: 10,
    coberturaOrigemAntes: null,
    coberturaOrigemDepois: null,
    coberturaDestinoAntes: null,
    coberturaDestinoDepois: null,
    vendasOrigem30: 0,
    vendasOrigem90: 0,
    justificativa: ["Justificativa sintética de teste."],
    impactoEsperado: "",
    ...overrides,
  } as MovimentacaoRecomendada;
}

function excesso(overrides: Partial<ProdutoExcessoDistribuicao> = {}): ProdutoExcessoDistribuicao {
  return {
    produto: "Classic Black",
    grupo: "Camisetas",
    cods: ["COD-1"],
    classificacao: "BEST_SELLER",
    excessoCD: 0,
    estoqueCDPermanece: 0,
    excessoLojas: 0,
    rupturaLojas: 0,
    rupturaComExcessoDisponivel: false,
    oportunidades: [],
    dropsCicloAtivoProtegidos: 0,
    excessoDropProtegido: 0,
    reservaContinuidadeBestSeller: 0,
    ...overrides,
  };
}

function bestSeller(overrides: Partial<RecomendacaoBestSellerPorProduto> = {}): RecomendacaoBestSellerPorProduto {
  return {
    produto: "Classic Black",
    cod: "COD-1",
    grupo: "Camisetas",
    estoqueDisponivelUtilizavel: 0,
    demandaProjetadaHorizonte: 0,
    coberturaAtualDias: null,
    recebimentosUtilizaveis: 0,
    quantidadeSugerida: 0,
    valorEstimado: null,
    confiavel: true,
    premissas: [],
    avisos: [],
    ...overrides,
  };
}

function drop(overrides: Partial<RecomendacaoDropPorProduto> = {}): RecomendacaoDropPorProduto {
  return {
    produto: "Drop X",
    cod: "COD-D1",
    colecao: "DROP-X",
    grupo: "Camisetas",
    diasRestantesJanela: 10,
    estoqueDisponivel: 0,
    sellThroughAtual: null,
    previsaoVendaAteFimJanela: 0,
    riscoSobra: false,
    excedenteEstimado: 0,
    riscoRuptura: false,
    faltanteEstimado: 0,
    quantidadeSugerida: null,
    valorEstimado: null,
    bloqueadoRecompra: false,
    precisaConfirmacaoHumana: false,
    premissas: [],
    avisos: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<InputRecomendacaoPrincipal> = {}): InputRecomendacaoPrincipal {
  return {
    situacao: "equilibrado",
    classificacao: "BEST_SELLER",
    demandaPossivelmenteMascarada: false,
    excesso: null,
    recomendacoesBestSeller: [],
    recomendacoesDrop: [],
    ...overrides,
  };
}

describe("sintetizarRecomendacaoPrincipal", () => {
  it("sem_dado -> sem_dado_suficiente, nunca inventa recomendação", () => {
    const r = sintetizarRecomendacaoPrincipal(baseInput({ situacao: "sem_dado" }));
    expect(r.tipo).toBe("sem_dado_suficiente");
  });

  it("lancamento_recente -> aguardar, nunca transferir/comprar/reduzir (correção da regra de estoque parado)", () => {
    const r = sintetizarRecomendacaoPrincipal(baseInput({ situacao: "lancamento_recente" }));
    expect(r.tipo).toBe("aguardar");
    expect(r.justificativa.join(" ")).toMatch(/90 dias/);
  });

  it("ruptura + excesso disponível em outra posição -> transferir, NUNCA comprar (regra central: nunca comprar quando redistribuição resolveria)", () => {
    const r = sintetizarRecomendacaoPrincipal(
      baseInput({
        situacao: "ruptura",
        excesso: excesso({ rupturaComExcessoDisponivel: true, oportunidades: [oportunidade({ quantidadeSugerida: 15 })] }),
        recomendacoesBestSeller: [bestSeller({ quantidadeSugerida: 50 })], // mesmo com sugestão de compra positiva
      })
    );
    expect(r.tipo).toBe("transferir");
    expect(r.justificativa.some((j) => j.includes("15"))).toBe(true);
  });

  it("ruptura, sem redistribuição disponível, Best Seller com quantidade sugerida -> comprar, cita a quantidade real", () => {
    const r = sintetizarRecomendacaoPrincipal(
      baseInput({
        situacao: "cobertura_critica",
        recomendacoesBestSeller: [bestSeller({ quantidadeSugerida: 42, confiavel: true, premissas: ["premissa-x"] })],
      })
    );
    expect(r.tipo).toBe("comprar");
    expect(r.justificativa.some((j) => j.includes("42"))).toBe(true);
    expect(r.justificativa).toContain("premissa-x");
  });

  it("ruptura, Drop com risco de ruptura e quantidade sugerida -> comprar", () => {
    const r = sintetizarRecomendacaoPrincipal(
      baseInput({
        situacao: "ruptura",
        classificacao: "DROP",
        recomendacoesDrop: [drop({ riscoRuptura: true, quantidadeSugerida: 30 })],
      })
    );
    expect(r.tipo).toBe("comprar");
  });

  it("ruptura, Drop precisa confirmação humana -> revisar_classificacao, nunca inventa quantidade", () => {
    const r = sintetizarRecomendacaoPrincipal(
      baseInput({
        situacao: "ruptura",
        classificacao: "DROP",
        recomendacoesDrop: [drop({ riscoRuptura: true, precisaConfirmacaoHumana: true, quantidadeSugerida: null })],
      })
    );
    expect(r.tipo).toBe("revisar_classificacao");
  });

  it("ruptura, Drop bloqueado pra recompra -> sem_necessidade (decisão humana já tomada)", () => {
    const r = sintetizarRecomendacaoPrincipal(
      baseInput({
        situacao: "ruptura",
        classificacao: "DROP",
        recomendacoesDrop: [drop({ riscoRuptura: true, bloqueadoRecompra: true, quantidadeSugerida: 0 })],
      })
    );
    expect(r.tipo).toBe("sem_necessidade");
  });

  it("ruptura, produto NAO_CLASSIFICADO -> revisar_classificacao, pede classificação em vez de inventar régua", () => {
    const r = sintetizarRecomendacaoPrincipal(baseInput({ situacao: "ruptura", classificacao: "NAO_CLASSIFICADO" }));
    expect(r.tipo).toBe("revisar_classificacao");
    expect(r.justificativa.join(" ")).toMatch(/classifica/i);
  });

  it("cobertura_excessiva protegida (Drop ativo/reserva Best Seller) -> aguardar, nunca reduzir_exposicao", () => {
    const r = sintetizarRecomendacaoPrincipal(
      baseInput({ situacao: "cobertura_excessiva", excesso: excesso({ dropsCicloAtivoProtegidos: 2 }) })
    );
    expect(r.tipo).toBe("aguardar");
  });

  it("estoque_parado com oportunidade de transferência -> transferir", () => {
    const r = sintetizarRecomendacaoPrincipal(
      baseInput({
        situacao: "estoque_parado",
        excesso: excesso({ oportunidades: [oportunidade({ quantidadeSugerida: 8 })] }),
      })
    );
    expect(r.tipo).toBe("transferir");
  });

  it("estoque_parado sem nenhuma retenção/oportunidade -> reduzir_exposicao, nunca comprar", () => {
    const r = sintetizarRecomendacaoPrincipal(baseInput({ situacao: "estoque_parado" }));
    expect(r.tipo).toBe("reduzir_exposicao");
  });

  it("equilibrado -> sem_necessidade", () => {
    const r = sintetizarRecomendacaoPrincipal(baseInput({ situacao: "equilibrado" }));
    expect(r.tipo).toBe("sem_necessidade");
  });

  it("toda recomendação tem pelo menos 1 linha de justificativa não vazia", () => {
    const situacoes: InputRecomendacaoPrincipal["situacao"][] = [
      "sem_dado",
      "ruptura",
      "cobertura_critica",
      "equilibrado",
      "cobertura_excessiva",
      "estoque_parado",
      "lancamento_recente",
    ];
    for (const situacao of situacoes) {
      const r = sintetizarRecomendacaoPrincipal(baseInput({ situacao }));
      expect(r.justificativa.length).toBeGreaterThan(0);
      for (const linha of r.justificativa) expect(linha.trim().length).toBeGreaterThan(0);
    }
  });
});
