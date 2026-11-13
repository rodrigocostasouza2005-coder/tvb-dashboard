import { describe, it, expect } from "vitest";
import { TipoCompraProduto } from "@prisma/client";
import {
  diagnosticarVariante,
  limiarExcessivo,
  ehTamanhoNucleo,
  calcularMovimentacoes,
  avaliarConfianca,
  prioridadeDoDestino,
  agruparMovimentacoesPorPar,
  montarMatrizGrade,
  resumirGrupoGrade,
  type VariantePorLoja,
  type MovimentacaoRecomendada,
  type ContextoMovimentacao,
  type GradePosicao,
} from "../distribuicao-estoque";

function variante(overrides: Partial<VariantePorLoja> = {}): VariantePorLoja {
  const base: VariantePorLoja = {
    storeId: "store-leblon",
    storeCode: "LEBLON",
    storeName: "Leblon",
    tipoPosicao: "loja",
    estoqueAtual: 0,
    vendasDias30: 0,
    vendasDias60: 0,
    vendasDias90: 0,
    velocidadeDiaria: 0,
    coberturaDias: null,
    estoqueMinimo: null,
    diagnostico: "sem_dado",
    ...overrides,
  };
  return { ...base, diagnostico: diagnosticarVariante(base, base.tipoPosicao) };
}

const CONTEXTO_BASE = {
  cod: "COD-1",
  produto: "Classic Blue",
  grupo: "Camisetas",
  cor: "Azul",
  tamanho: "M",
  coberturaAlvoDias: 30,
};

function contextoMov(overrides: Partial<ContextoMovimentacao> = {}): ContextoMovimentacao {
  return {
    ...CONTEXTO_BASE,
    tipoCompra: null,
    vendasSite90: 0,
    gradePorPosicao: {},
    ...overrides,
  };
}

function grade(comEstoque: number, comVenda: number, total = 4): GradePosicao {
  return { tamanhosComEstoque: comEstoque, tamanhosComVenda: comVenda, totalTamanhos: total };
}

// Atalho pros cenários de elegibilidade que não envolvem CD/Site: roda o motor completo e olha só
// a direção Loja→Loja. Os cenários abaixo são os mesmos que cobriam a função original de
// 2026-10-30 (calcularOportunidadeTransferencia, absorvida por calcularMovimentacoes) — ficam aqui
// como regressão das regras de origem/destino/quantidade, que não mudaram.
function movLojaLoja(variantes: VariantePorLoja[], contexto: typeof CONTEXTO_BASE) {
  return calcularMovimentacoes(variantes, contextoMov(contexto)).movimentacoes.filter(
    (m) => m.tipoMovimentacao === "loja_loja"
  );
}

// Helpers de posição reutilizados pelos cenários das 3 direções.
const cd = (overrides: Partial<VariantePorLoja> = {}) =>
  variante({ storeId: "cd|atacado", storeCode: "CD|ATACADO", storeName: "TVB Site e Atacado", tipoPosicao: "cd_site", ...overrides });

describe("diagnosticarVariante", () => {
  it("sem estoque e sem venda em 90d -> sem_dado (não há o que analisar)", () => {
    expect(diagnosticarVariante({ estoqueAtual: 0, vendasDias30: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null })).toBe(
      "sem_dado"
    );
  });

  it("sem estoque mas com venda real em 90d -> ruptura (demanda não atendida)", () => {
    expect(diagnosticarVariante({ estoqueAtual: 0, vendasDias30: 0, vendasDias90: 5, velocidadeDiaria: 0, coberturaDias: null })).toBe(
      "ruptura"
    );
  });

  it("estoque positivo mas nenhuma venda em 90d -> estoque_parado", () => {
    expect(diagnosticarVariante({ estoqueAtual: 10, vendasDias30: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null })).toBe(
      "estoque_parado"
    );
  });

  it("cobertura abaixo de 7 dias -> cobertura_critica", () => {
    expect(
      diagnosticarVariante({ estoqueAtual: 3, vendasDias30: 30, vendasDias90: 90, velocidadeDiaria: 1, coberturaDias: 3 })
    ).toBe("cobertura_critica");
  });

  it("cobertura acima de 60 dias -> cobertura_excessiva", () => {
    expect(
      diagnosticarVariante({ estoqueAtual: 100, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 0.33, coberturaDias: 300 })
    ).toBe("cobertura_excessiva");
  });

  it("cobertura entre 7 e 60 dias -> equilibrado", () => {
    expect(
      diagnosticarVariante({ estoqueAtual: 20, vendasDias30: 20, vendasDias90: 60, velocidadeDiaria: 0.67, coberturaDias: 30 })
    ).toBe("equilibrado");
  });

  // CD/Site (2026-11-11): a mesma cobertura que é excesso numa loja é normal no CD, que abastece
  // as 3 lojas E o ecommerce nacional.
  it("70 dias de cobertura: excesso numa loja, equilibrado no CD/Site", () => {
    const entrada = { estoqueAtual: 70, vendasDias30: 30, vendasDias90: 90, velocidadeDiaria: 1, coberturaDias: 70 };
    expect(diagnosticarVariante(entrada, "loja")).toBe("cobertura_excessiva");
    expect(diagnosticarVariante(entrada, "cd_site")).toBe("equilibrado");
  });

  it("acima de 90 dias o CD/Site também entra em cobertura_excessiva", () => {
    expect(
      diagnosticarVariante({ estoqueAtual: 120, vendasDias30: 30, vendasDias90: 90, velocidadeDiaria: 1, coberturaDias: 120 }, "cd_site")
    ).toBe("cobertura_excessiva");
  });

  it("ruptura e estoque parado não dependem do tipo de posição", () => {
    expect(diagnosticarVariante({ estoqueAtual: 0, vendasDias30: 1, vendasDias90: 5, velocidadeDiaria: 0, coberturaDias: null }, "cd_site")).toBe(
      "ruptura"
    );
    expect(diagnosticarVariante({ estoqueAtual: 9, vendasDias30: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null }, "cd_site")).toBe(
      "estoque_parado"
    );
  });

  it("limiarExcessivo expõe o parâmetro usado por cada tipo de posição", () => {
    expect(limiarExcessivo("loja")).toBe(60);
    expect(limiarExcessivo("cd_site")).toBe(90);
  });
});

describe("calcularMovimentacoes — regras de elegibilidade herdadas da versão Loja→Loja original", () => {
  const contextoBase = CONTEXTO_BASE;

  it("exemplo do pedido: origem com sobra parada + destino com demanda real -> sugere transferência", () => {
    const rioSul = variante({
      storeId: "rio-sul",
      storeCode: "RIOSUL",
      storeName: "Rio Sul",
      estoqueAtual: 12,
      vendasDias30: 0,
      vendasDias60: 0,
      vendasDias90: 0,
      velocidadeDiaria: 0,
    });
    const leblon = variante({
      storeId: "leblon",
      storeCode: "LEBLON",
      storeName: "Leblon",
      estoqueAtual: 2,
      vendasDias30: 15,
      vendasDias60: 28,
      vendasDias90: 40,
      velocidadeDiaria: 15 / 30,
      coberturaDias: 2 / (15 / 30),
    });
    const resultado = movLojaLoja([rioSul, leblon], contextoBase);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].origemNome).toBe("Rio Sul");
    expect(resultado[0].destinoNome).toBe("Leblon");
    expect(resultado[0].quantidadeSugerida).toBeGreaterThan(0);
    expect(resultado[0].estoqueOrigemDepois).toBeLessThan(resultado[0].estoqueOrigemAntes);
    expect(resultado[0].estoqueDestinoDepois).toBeGreaterThan(resultado[0].estoqueDestinoAntes);
  });

  it("origem no próprio mínimo (sem sobra real) -> nenhuma sugestão", () => {
    const origemNoMinimo = variante({
      storeId: "rio-sul",
      storeName: "Rio Sul",
      estoqueAtual: 10,
      estoqueMinimo: 10,
      vendasDias30: 0,
      vendasDias90: 0,
    });
    const destinoCritico = variante({
      storeId: "leblon",
      storeName: "Leblon",
      estoqueAtual: 0,
      vendasDias30: 5,
      vendasDias90: 10,
      velocidadeDiaria: 5 / 30,
    });
    const resultado = movLojaLoja([origemNoMinimo, destinoCritico], contextoBase);
    expect(resultado).toHaveLength(0);
  });

  it("distribuição equilibrada entre todas as lojas -> nenhuma sugestão", () => {
    const equilibrada = (storeId: string, storeName: string) =>
      variante({ storeId, storeName, estoqueAtual: 20, vendasDias30: 20, vendasDias90: 60, velocidadeDiaria: 20 / 30, coberturaDias: 30 });
    const resultado = movLojaLoja(
      [equilibrada("leblon", "Leblon"), equilibrada("barra", "Barra"), equilibrada("rio-sul", "Rio Sul")],
      contextoBase
    );
    expect(resultado).toHaveLength(0);
  });

  it("uma origem com bastante sobra pode abastecer dois destinos diferentes", () => {
    const origemGrande = variante({
      storeId: "rio-sul",
      storeName: "Rio Sul",
      estoqueAtual: 100,
      vendasDias30: 0,
      vendasDias90: 0,
    });
    const destino1 = variante({
      storeId: "leblon",
      storeName: "Leblon",
      estoqueAtual: 0,
      vendasDias30: 10,
      vendasDias90: 20,
      velocidadeDiaria: 10 / 30,
    });
    const destino2 = variante({
      storeId: "barra",
      storeName: "Barra",
      estoqueAtual: 0,
      vendasDias30: 6,
      vendasDias90: 12,
      velocidadeDiaria: 6 / 30,
    });
    const resultado = movLojaLoja([origemGrande, destino1, destino2], contextoBase);
    expect(resultado).toHaveLength(2);
    expect(new Set(resultado.map((r) => r.origemNome))).toEqual(new Set(["Rio Sul"]));
    expect(new Set(resultado.map((r) => r.destinoNome))).toEqual(new Set(["Leblon", "Barra"]));
  });

  it("nunca sugere origem == destino", () => {
    const unica = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 5, vendasDias90: 10, velocidadeDiaria: 5 / 30 });
    const resultado = movLojaLoja([unica], contextoBase);
    expect(resultado).toHaveLength(0);
  });

  it("ruptura sem venda recente nenhuma (sem_dado) não é tratada como demanda -> nenhuma sugestão", () => {
    const semDado = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 0, vendasDias90: 0 });
    const origemParada = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 50, vendasDias30: 0, vendasDias90: 0 });
    const resultado = movLojaLoja([semDado, origemParada], contextoBase);
    expect(resultado).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AS 3 DIREÇÕES (2026-11-11)
// ---------------------------------------------------------------------------

describe("calcularMovimentacoes — direção Loja → Loja", () => {
  it("mantém a recomendação loja→loja que já existia, agora classificada como REDISTRIBUIR", () => {
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    const leblon = variante({
      storeId: "leblon",
      storeName: "Leblon",
      estoqueAtual: 2,
      vendasDias30: 15,
      vendasDias90: 40,
      velocidadeDiaria: 15 / 30,
      coberturaDias: 4,
    });
    const { movimentacoes } = calcularMovimentacoes([rioSul, leblon], contextoMov());
    expect(movimentacoes).toHaveLength(1);
    expect(movimentacoes[0]).toMatchObject({
      tipoMovimentacao: "loja_loja",
      classificacao: "REDISTRIBUIR",
      origemNome: "Rio Sul",
      destinoNome: "Leblon",
    });
    expect(movimentacoes[0].justificativa.length).toBeGreaterThan(0);
    expect(movimentacoes[0].impactoEsperado).toContain("Leblon");
  });

  it("prioridade vem do estado do destino: ruptura = alta, cobertura crítica = média, recolhimento = baixa", () => {
    expect(prioridadeDoDestino("ruptura")).toBe("alta");
    expect(prioridadeDoDestino("cobertura_critica")).toBe("media");
    expect(prioridadeDoDestino("equilibrado")).toBe("baixa");
  });
});

describe("calcularMovimentacoes — direção CD/Site → Loja (abastecimento)", () => {
  it("CD/Site abastece a loja em ruptura mesmo sem estar em excesso de catálogo", () => {
    const leblon = variante({
      storeId: "leblon",
      storeName: "Leblon",
      estoqueAtual: 0,
      vendasDias30: 15,
      vendasDias90: 40,
    });
    const cdSite = cd({ estoqueAtual: 100, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 300 });
    const { movimentacoes } = calcularMovimentacoes([leblon, cdSite], contextoMov());
    expect(movimentacoes).toHaveLength(1);
    expect(movimentacoes[0]).toMatchObject({
      tipoMovimentacao: "cd_site_loja",
      classificacao: "REDISTRIBUIR",
      origemNome: "TVB Site e Atacado",
      destinoNome: "Leblon",
      prioridade: "alta",
    });
    // Necessidade = 30 dias de cobertura à velocidade de 0,5/dia = 15 un.
    expect(movimentacoes[0].quantidadeSugerida).toBe(15);
  });

  it("redistribuição entre lojas vem ANTES de consumir o CD/Site (ordem deliberada)", () => {
    const leblon = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 15, vendasDias90: 40 });
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    const cdSite = cd({ estoqueAtual: 100, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 300 });
    const { movimentacoes } = calcularMovimentacoes([leblon, rioSul, cdSite], contextoMov());
    const lojaLoja = movimentacoes.find((m) => m.tipoMovimentacao === "loja_loja");
    const doCd = movimentacoes.find((m) => m.tipoMovimentacao === "cd_site_loja");
    expect(lojaLoja?.quantidadeSugerida).toBe(12);
    // Só os 3 que faltaram saem do CD — não os 15 inteiros.
    expect(doCd?.quantidadeSugerida).toBe(3);
  });

  it("CD/Site em ruptura/cobertura crítica não abastece ninguém (não tem o que doar)", () => {
    const leblon = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 15, vendasDias90: 40 });
    const cdSite = cd({ estoqueAtual: 0, vendasDias30: 5, vendasDias90: 20 });
    const { movimentacoes } = calcularMovimentacoes([leblon, cdSite], contextoMov());
    expect(movimentacoes).toHaveLength(0);
  });

  it("CD/Site respeita o próprio estoque mínimo (StockMinimumRule) ao abastecer", () => {
    const leblon = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 15, vendasDias90: 40 });
    const cdSite = cd({ estoqueAtual: 100, estoqueMinimo: 100, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 300 });
    const { movimentacoes } = calcularMovimentacoes([leblon, cdSite], contextoMov());
    expect(movimentacoes.filter((m) => m.tipoMovimentacao === "cd_site_loja")).toHaveLength(0);
  });
});

describe("calcularMovimentacoes — direção Loja → CD/Site (recolhimento)", () => {
  it("recolhe quando há demanda local baixa E potencial online comprovado", () => {
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 20, estoqueMinimo: 5 });
    const cdSite = cd({ estoqueAtual: 30, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 90 });
    const { movimentacoes } = calcularMovimentacoes(
      [rioSul, cdSite],
      contextoMov({ vendasSite90: 12, gradePorPosicao: { "rio-sul": grade(4, 4) } })
    );
    expect(movimentacoes).toHaveLength(1);
    expect(movimentacoes[0]).toMatchObject({
      tipoMovimentacao: "loja_cd_site",
      classificacao: "RECOLHER_PARA_CD_SITE",
      origemNome: "Rio Sul",
      destinoNome: "TVB Site e Atacado",
      prioridade: "baixa",
      quantidadeSugerida: 15,
    });
    expect(movimentacoes[0].justificativa.join(" ")).toContain("12 un.");
  });

  it("recolhe quando há demanda local baixa E grade quebrada, COM venda online comprovada", () => {
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    const cdSite = cd({ estoqueAtual: 30, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 90 });
    const { movimentacoes } = calcularMovimentacoes(
      [rioSul, cdSite],
      contextoMov({ vendasSite90: 7, gradePorPosicao: { "rio-sul": grade(1, 3) } })
    );
    expect(movimentacoes).toHaveLength(1);
    expect(movimentacoes[0].tipoMovimentacao).toBe("loja_cd_site");
    expect(movimentacoes[0].justificativa.join(" ")).toContain("Grade quebrada");
  });

  // Regra revista 2026-11-13 (pedido Rodrigo): venda no site passou de "1 sinal entre 3" pra
  // OBRIGATÓRIA — demanda local baixa + grade quebrada SEM venda real no site não justifica mais
  // recolher. Este teste documentava o comportamento antigo (nome antigo: "...sem precisar de
  // venda online") e foi invertido pra travar a regra nova.
  it("NÃO recolhe só com demanda local baixa + grade quebrada, sem venda real no site", () => {
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    const cdSite = cd({ estoqueAtual: 30, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 90 });
    const { movimentacoes, manter } = calcularMovimentacoes(
      [rioSul, cdSite],
      contextoMov({ vendasSite90: 0, gradePorPosicao: { "rio-sul": grade(1, 3) } })
    );
    expect(movimentacoes.filter((m) => m.tipoMovimentacao === "loja_cd_site")).toHaveLength(0);
    expect(manter[0].motivo.join(" ")).toContain("sem venda no site");
  });

  it("NÃO recolhe só por venda comprovada no site, sem sinal local (loja ainda precisa da peça)", () => {
    const rioSul = variante({
      storeId: "rio-sul",
      storeName: "Rio Sul",
      estoqueAtual: 40,
      vendasDias30: 15,
      vendasDias90: 45,
      velocidadeDiaria: 0.5,
      coberturaDias: 80,
    });
    const cdSite = cd({ estoqueAtual: 30, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 90 });
    const { movimentacoes, manter } = calcularMovimentacoes(
      [rioSul, cdSite],
      contextoMov({ vendasSite90: 50, gradePorPosicao: { "rio-sul": grade(4, 4) } })
    );
    expect(movimentacoes.filter((m) => m.tipoMovimentacao === "loja_cd_site")).toHaveLength(0);
    expect(manter[0].motivo.join(" ")).toContain("ainda vende");
  });

  it("CD/Site zerado e sem venda no site → sinaliza necessidade de reposição, não 'sem interesse'", () => {
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    const cdSiteZerado = cd({ estoqueAtual: 0, vendasDias30: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null });
    const { movimentacoes, manter } = calcularMovimentacoes(
      [rioSul, cdSiteZerado],
      contextoMov({ vendasSite90: 0, gradePorPosicao: { "rio-sul": grade(1, 3) } })
    );
    expect(movimentacoes.filter((m) => m.tipoMovimentacao === "loja_cd_site")).toHaveLength(0);
    const manterRioSul = manter.find((m) => m.posicaoNome === "Rio Sul")!;
    expect(manterRioSul.necessidadeReposicao).toBe(true);
    expect(manterRioSul.motivo.join(" ")).toContain("necessidade de reposição");
  });

  it("CD/Site com estoque disponível e sem venda no site → MANTER por falta de demanda (não ruptura)", () => {
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    const cdSite = cd({ estoqueAtual: 30, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 90 });
    const { manter } = calcularMovimentacoes(
      [rioSul, cdSite],
      contextoMov({ vendasSite90: 0, gradePorPosicao: { "rio-sul": grade(1, 3) } })
    );
    const manterRioSul = manter.find((m) => m.posicaoNome === "Rio Sul")!;
    expect(manterRioSul.necessidadeReposicao).toBeUndefined();
    expect(manterRioSul.motivo.join(" ")).toContain("sem venda no site");
  });

  it("NÃO recolhe peça isolada com um sinal só — vira MANTER com motivo escrito", () => {
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 20, estoqueMinimo: 5 });
    const cdSite = cd({ estoqueAtual: 30, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 90 });
    const { movimentacoes, manter } = calcularMovimentacoes(
      [rioSul, cdSite],
      contextoMov({ vendasSite90: 0, gradePorPosicao: { "rio-sul": grade(4, 4) } })
    );
    expect(movimentacoes).toHaveLength(0);
    expect(manter).toHaveLength(1);
    expect(manter[0].posicaoNome).toBe("Rio Sul");
    expect(manter[0].motivo.join(" ")).toContain("sem venda no site");
  });

  it("NÃO recolhe só por grade quebrada quando a loja ainda vende bem o SKU", () => {
    const rioSul = variante({
      storeId: "rio-sul",
      storeName: "Rio Sul",
      estoqueAtual: 100,
      vendasDias30: 30,
      vendasDias90: 90,
      velocidadeDiaria: 1,
      coberturaDias: 100,
    });
    const cdSite = cd({ estoqueAtual: 30, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 90 });
    const { movimentacoes, manter } = calcularMovimentacoes(
      [rioSul, cdSite],
      contextoMov({ vendasSite90: 0, gradePorPosicao: { "rio-sul": grade(1, 3) } })
    );
    expect(movimentacoes).toHaveLength(0);
    expect(manter[0].motivo.join(" ")).toContain("ainda vende");
  });

  it("Best Seller em reposição recorrente nunca é recolhido — MANTER citando a classificação", () => {
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 40 });
    const cdSite = cd({ estoqueAtual: 30, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 90 });
    const { movimentacoes, manter } = calcularMovimentacoes(
      [rioSul, cdSite],
      contextoMov({
        tipoCompra: TipoCompraProduto.BEST_SELLER,
        vendasSite90: 50,
        gradePorPosicao: { "rio-sul": grade(1, 4) },
      })
    );
    expect(movimentacoes.filter((m) => m.classificacao === "RECOLHER_PARA_CD_SITE")).toHaveLength(0);
    expect(manter[0].motivo.join(" ")).toContain("BEST SELLER");
  });

  it("peça que outra loja precisa é redistribuída, não recolhida", () => {
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    const leblon = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 15, vendasDias90: 40 });
    const cdSite = cd({ estoqueAtual: 30, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 90 });
    const { movimentacoes } = calcularMovimentacoes(
      [rioSul, leblon, cdSite],
      contextoMov({ vendasSite90: 99, gradePorPosicao: { "rio-sul": grade(1, 3) } })
    );
    // Rio Sul tinha TODOS os sinais de recolhimento (parado, grade quebrada, site vendendo 99 un.),
    // mas Leblon precisava da peça: o estoque dela vai pro varejo, nunca pro CD. O CD só entra
    // depois, pra cobrir os 3 que faltaram.
    expect(movimentacoes.filter((m) => m.tipoMovimentacao === "loja_cd_site")).toHaveLength(0);
    expect(movimentacoes.find((m) => m.origemNome === "Rio Sul")).toMatchObject({
      tipoMovimentacao: "loja_loja",
      destinoNome: "Leblon",
      quantidadeSugerida: 12,
    });
  });

  // Achado rodando contra o dado real do dev (2026-11-11): sem este guard o motor recolhia pra um
  // CD/Site que já tinha 106 un. e 3.180 dias de cobertura do mesmo SKU.
  it("NÃO recolhe pra um CD/Site que já está afogado no mesmo SKU", () => {
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 18 });
    const cdSiteAfogado = cd({
      estoqueAtual: 106,
      vendasDias30: 1,
      vendasDias90: 3,
      velocidadeDiaria: 1 / 30,
      coberturaDias: 3180,
    });
    const { movimentacoes, manter } = calcularMovimentacoes(
      [rioSul, cdSiteAfogado],
      contextoMov({ vendasSite90: 3, gradePorPosicao: { "rio-sul": grade(1, 3) } })
    );
    expect(movimentacoes).toHaveLength(0);
    expect(manter.find((m) => m.posicaoNome === "Rio Sul")!.motivo.join(" ")).toContain("só muda a peça de lugar");
  });

  it("sem posição CD/Site visível não existe recolhimento — MANTER explica a ausência de destino", () => {
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    const { movimentacoes, manter } = calcularMovimentacoes(
      [rioSul],
      contextoMov({ vendasSite90: 10, gradePorPosicao: { "rio-sul": grade(1, 3) } })
    );
    expect(movimentacoes).toHaveLength(0);
    expect(manter[0].motivo.join(" ")).toContain("não está entre as unidades visíveis");
  });

  it("sobra que ninguém precisa e que não justifica recolher aparece como MANTER, não como silêncio", () => {
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 20, estoqueMinimo: 5 });
    const { manter } = calcularMovimentacoes([rioSul], contextoMov());
    expect(manter).toHaveLength(1);
    expect(manter[0].diagnostico).toBe("estoque_parado");
  });
});

describe("avaliarConfianca — gap de estoque reservado tratado como gap, não inventado", () => {
  it("sugestão que esvazia a origem cai pra baixa confiança citando a falta de estoque reservado", () => {
    const r = avaliarConfianca({
      tipoMovimentacao: "loja_loja",
      estoqueOrigemDepois: 0,
      quantidadeSugerida: 10,
      estoqueOrigemAntes: 10,
      tipoCompra: TipoCompraProduto.DROP,
      vendasSite90: 5,
    });
    expect(r.confianca).toBe("baixa");
    expect(r.avisos.join(" ")).toContain("estoque reservado/comprometido");
  });

  it("recolhimento sem nenhuma venda no site é baixa confiança (potencial online não medido)", () => {
    const r = avaliarConfianca({
      tipoMovimentacao: "loja_cd_site",
      estoqueOrigemDepois: 5,
      quantidadeSugerida: 5,
      estoqueOrigemAntes: 10,
      tipoCompra: TipoCompraProduto.DROP,
      vendasSite90: 0,
    });
    expect(r.confianca).toBe("baixa");
    expect(r.avisos.join(" ")).toContain("nenhuma venda no site");
  });

  it("recolhimento de produto sem classificação Best Seller/Drop fica em confiança média", () => {
    const r = avaliarConfianca({
      tipoMovimentacao: "loja_cd_site",
      estoqueOrigemDepois: 5,
      quantidadeSugerida: 5,
      estoqueOrigemAntes: 10,
      tipoCompra: null,
      vendasSite90: 20,
    });
    expect(r.confianca).toBe("media");
    expect(r.avisos.join(" ")).toContain("sem classificação Best Seller/Drop");
  });

  it("redistribuição que deixa estoque sobrando na origem e com produto classificado é alta confiança", () => {
    const r = avaliarConfianca({
      tipoMovimentacao: "loja_loja",
      estoqueOrigemDepois: 20,
      quantidadeSugerida: 5,
      estoqueOrigemAntes: 25,
      tipoCompra: TipoCompraProduto.DROP,
      vendasSite90: 0,
    });
    expect(r.confianca).toBe("alta");
    expect(r.avisos).toHaveLength(0);
  });

  it("toda movimentação com confiança != alta carrega pelo menos um aviso legível", () => {
    // vendasSite90 precisa ser > 0 (regra 2026-11-13: venda no site passou a ser obrigatória pra
    // recolher) — com 0 aqui a movimentação nem seria gerada e o loop abaixo ficaria vazio sem
    // testar nada de verdade. 2un. já basta pra satisfazer o gate e manter o cenário de baixa
    // confiança (tipoCompra null → aviso "sem classificação Best Seller/Drop").
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    const cdSite = cd({ estoqueAtual: 30, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 90 });
    const { movimentacoes } = calcularMovimentacoes(
      [rioSul, cdSite],
      contextoMov({ vendasSite90: 2, gradePorPosicao: { "rio-sul": grade(1, 3) } })
    );
    expect(movimentacoes.length).toBeGreaterThan(0);
    for (const m of movimentacoes) {
      if (m.confianca !== "alta") expect(m.avisos.length).toBeGreaterThan(0);
    }
  });
});

describe("agruparMovimentacoesPorPar", () => {
  function mov(overrides: Partial<MovimentacaoRecomendada>): MovimentacaoRecomendada {
    return {
      cod: "A",
      produto: "Classic",
      grupo: "Shorts",
      cor: null,
      tamanho: "40",
      tipoMovimentacao: "loja_loja",
      classificacao: "REDISTRIBUIR",
      prioridade: "media",
      confianca: "alta",
      origemPosicaoId: "o",
      origemNome: "Rio Sul",
      destinoPosicaoId: "d",
      destinoNome: "Leblon",
      quantidadeSugerida: 1,
      estoqueOrigemAntes: 10,
      estoqueOrigemDepois: 9,
      estoqueDestinoAntes: 0,
      estoqueDestinoDepois: 1,
      disponivelOrigem: 10,
      coberturaOrigemAntes: null,
      coberturaOrigemDepois: null,
      coberturaDestinoAntes: null,
      coberturaDestinoDepois: null,
      vendasOrigem30: 0,
      vendasOrigem90: 0,
      vendasDestino30: 1,
      vendasDestino90: 2,
      giroOrigemDia: 0,
      giroDestinoDia: 0,
      justificativa: [],
      impactoEsperado: "",
      avisos: [],
      ...overrides,
    };
  }

  it("agrupa as 3 direções pelo par de NOMES origem→destino, incluindo o CD/Site", () => {
    const grupos = agruparMovimentacoesPorPar([
      mov({ origemNome: "Rio Sul", destinoNome: "TVB Site e Atacado", tipoMovimentacao: "loja_cd_site", quantidadeSugerida: 4 }),
      mov({ origemNome: "TVB Site e Atacado", destinoNome: "Leblon", tipoMovimentacao: "cd_site_loja", quantidadeSugerida: 6 }),
      mov({ origemNome: "Rio Sul", destinoNome: "TVB Site e Atacado", tipoMovimentacao: "loja_cd_site", quantidadeSugerida: 1 }),
    ]);
    expect(grupos.map((g) => `${g.lojaOrigem}->${g.lojaDestino}`)).toEqual([
      "Rio Sul->TVB Site e Atacado",
      "TVB Site e Atacado->Leblon",
    ]);
    expect(grupos[0].totalQuantidade).toBe(5);
    expect(grupos[1].totalQuantidade).toBe(6);
  });

  it("preserva a ordem dos itens dentro do grupo", () => {
    const grupos = agruparMovimentacoesPorPar([
      mov({ cod: "A", origemNome: "Rio Sul", destinoNome: "Leblon", quantidadeSugerida: 5 }),
      mov({ cod: "B", origemNome: "Rio Sul", destinoNome: "Leblon", quantidadeSugerida: 3 }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].itens.map((i) => i.cod)).toEqual(["A", "B"]);
    expect(grupos[0].totalQuantidade).toBe(8);
  });

  it("nunca mistura pares diferentes, mesmo com as mesmas 2 unidades em sentido invertido", () => {
    const grupos = agruparMovimentacoesPorPar([
      mov({ cod: "A", origemNome: "Rio Sul", destinoNome: "Leblon" }),
      mov({ cod: "B", origemNome: "Leblon", destinoNome: "Rio Sul" }),
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupos.find((g) => g.lojaOrigem === "Rio Sul")?.lojaDestino).toBe("Leblon");
    expect(grupos.find((g) => g.lojaOrigem === "Leblon")?.lojaDestino).toBe("Rio Sul");
  });

  it("ordena os grupos alfabeticamente por origem e depois destino, não por tamanho do grupo", () => {
    const grupos = agruparMovimentacoesPorPar([
      mov({ origemNome: "Rio Sul", destinoNome: "Leblon", quantidadeSugerida: 100 }),
      mov({ origemNome: "Barra", destinoNome: "Rio Sul", quantidadeSugerida: 1 }),
      mov({ origemNome: "Barra", destinoNome: "Leblon", quantidadeSugerida: 1 }),
    ]);
    expect(grupos.map((g) => `${g.lojaOrigem}->${g.lojaDestino}`)).toEqual([
      "Barra->Leblon",
      "Barra->Rio Sul",
      "Rio Sul->Leblon",
    ]);
  });

  it("lista vazia -> nenhum grupo", () => {
    expect(agruparMovimentacoesPorPar([])).toEqual([]);
  });
});

describe("montarMatrizGrade", () => {
  const posicoes = [
    { posicaoId: "leblon", posicaoNome: "TVB Leblon", tipoPosicao: "loja" as const },
    { posicaoId: "cd|atacado", posicaoNome: "TVB Site e Atacado", tipoPosicao: "cd_site" as const },
  ];

  function linha(tamanho: string, leblonEstoque: number, leblonVendas: number, cdEstoque: number) {
    return {
      produto: "Classic",
      grupo: "Shorts",
      cor: "Azul",
      tamanho,
      porLoja: [
        variante({ storeId: "leblon", storeName: "TVB Leblon", estoqueAtual: leblonEstoque, vendasDias30: leblonVendas, vendasDias90: leblonVendas }),
        cd({ estoqueAtual: cdEstoque }),
      ],
    };
  }

  it("monta a matriz tamanho × unidade com total por unidade e total geral", () => {
    const m = montarMatrizGrade([linha("40", 5, 3, 10), linha("42", 0, 2, 4)], posicoes)!;
    expect(m.linhas.map((l) => l.tamanho)).toEqual(["40", "42"]);
    expect(m.totalPorPosicao).toEqual([
      { posicaoId: "leblon", posicaoNome: "TVB Leblon", estoque: 5 },
      { posicaoId: "cd|atacado", posicaoNome: "TVB Site e Atacado", estoque: 14 },
    ]);
    expect(m.totalGeral).toBe(19);
  });

  it("buraco de grade = tamanho que a unidade comprovadamente vendeu em 90d e está com estoque 0", () => {
    const m = montarMatrizGrade([linha("40", 5, 3, 10), linha("42", 0, 2, 4)], posicoes)!;
    expect(m.linhas.find((l) => l.tamanho === "42")!.faltandoEm).toEqual(["TVB Leblon"]);
    expect(m.linhas.find((l) => l.tamanho === "40")!.faltandoEm).toEqual([]);
    expect(m.buracosGrade).toBe(1);
  });

  it("tamanho sem venda nenhuma e sem estoque NÃO conta como buraco (não é grade ideal fixa)", () => {
    const m = montarMatrizGrade([linha("46", 0, 0, 0)], posicoes)!;
    expect(m.buracosGrade).toBe(0);
  });

  it("38/40/42/44 são marcados como núcleo sem excluir os demais tamanhos da matriz", () => {
    const m = montarMatrizGrade([linha("38", 1, 1, 1), linha("46", 1, 1, 1), linha("P", 1, 1, 1)], posicoes)!;
    expect(m.linhas.map((l) => [l.tamanho, l.nucleo])).toEqual([
      ["38", true],
      ["46", false],
      ["P", false],
    ]);
    expect(ehTamanhoNucleo("42")).toBe(true);
    expect(ehTamanhoNucleo("48")).toBe(false);
    expect(ehTamanhoNucleo(null)).toBe(false);
  });

  it("ordena tamanho numérico por valor (não alfabeticamente)", () => {
    const m = montarMatrizGrade([linha("44", 1, 0, 0), linha("38", 1, 0, 0), linha("40", 1, 0, 0)], posicoes)!;
    expect(m.linhas.map((l) => l.tamanho)).toEqual(["38", "40", "44"]);
  });

  it("lista vazia -> null (nada a mostrar, não uma matriz vazia enganosa)", () => {
    expect(montarMatrizGrade([], posicoes)).toBeNull();
  });

  it("conta buraco de grade no núcleo separadamente do total", () => {
    const m = montarMatrizGrade([linha("40", 0, 2, 4), linha("46", 0, 2, 4)], posicoes)!;
    expect(m.buracosGrade).toBe(2);
    expect(m.buracosGradeNucleo).toBe(1);
  });
});

describe("resumirGrupoGrade", () => {
  const posicoes = [
    { posicaoId: "leblon", posicaoNome: "TVB Leblon" },
    { posicaoId: "cd|atacado", posicaoNome: "TVB Site e Atacado" },
  ];

  it("soma estoque por unidade e por tamanho, e deriva excesso/necessidade de venda real", () => {
    const variantes = [
      {
        grupo: "Shorts",
        produto: "Classic",
        tamanho: "40",
        porLoja: [
          // Vende 30/mês (1/dia) e tem 100 un: 70 acima do alvo de 30 dias -> excesso 70.
          variante({
            storeId: "leblon",
            storeName: "TVB Leblon",
            estoqueAtual: 100,
            vendasDias30: 30,
            vendasDias90: 90,
            velocidadeDiaria: 1,
            coberturaDias: 100,
          }),
          // Vende 30/mês e tem 10 un: faltam 20 pro alvo -> necessidade 20.
          cd({ estoqueAtual: 10, vendasDias30: 30, vendasDias90: 90, velocidadeDiaria: 1, coberturaDias: 10 }),
        ],
      },
    ];
    const r = resumirGrupoGrade("Shorts", variantes, posicoes, 30, 3);
    expect(r.quantidadeTotal).toBe(110);
    expect(r.porPosicao).toEqual([
      { posicaoId: "leblon", posicaoNome: "TVB Leblon", estoque: 100 },
      { posicaoId: "cd|atacado", posicaoNome: "TVB Site e Atacado", estoque: 10 },
    ]);
    expect(r.porTamanho).toEqual([{ tamanho: "40", nucleo: true, estoque: 110, vendas90: 180 }]);
    expect(r.demanda90).toBe(180);
    expect(r.excessoEstimado).toBe(70);
    expect(r.necessidadeEstimada).toBe(20);
    expect(r.oportunidades).toBe(3);
    expect(r.produtos).toBe(1);
  });

  it("estoque sem nenhuma venda não gera necessidade, só excesso", () => {
    const variantes = [
      {
        grupo: "Shorts",
        produto: "Classic",
        tamanho: "P",
        porLoja: [variante({ storeId: "leblon", storeName: "TVB Leblon", estoqueAtual: 8 })],
      },
    ];
    const r = resumirGrupoGrade("Shorts", variantes, posicoes, 30, 0);
    expect(r.excessoEstimado).toBe(8);
    expect(r.necessidadeEstimada).toBe(0);
    expect(r.porTamanho[0].nucleo).toBe(false);
  });
});
