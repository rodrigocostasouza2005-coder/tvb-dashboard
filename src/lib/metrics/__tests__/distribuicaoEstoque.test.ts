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

  // CORRIGIDO em 2026-11-13 (pedido explícito do Rodrigo, inverte a ordem de 2026-11-11): o CD é
  // SEMPRE a primeira origem tentada. Antes desta correção o teste esperava o oposto (loja→loja
  // levava os 12 de Rio Sul e só os 3 que faltavam saíam do CD) — agora o CD cobre a necessidade
  // inteira de Leblon (15) sozinho, e Rio Sul nem chega a ser consumido pela redistribuição.
  it("CD/Site é a PRIMEIRA origem tentada — nenhuma redistribuição loja→loja enquanto o CD cobrir", () => {
    const leblon = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 15, vendasDias90: 40 });
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    const cdSite = cd({ estoqueAtual: 100, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 300 });
    const { movimentacoes } = calcularMovimentacoes([leblon, rioSul, cdSite], contextoMov());
    const lojaLoja = movimentacoes.find((m) => m.tipoMovimentacao === "loja_loja");
    const doCd = movimentacoes.find((m) => m.tipoMovimentacao === "cd_site_loja");
    // CD cobre a necessidade inteira (15) — zero transferência loja→loja.
    expect(lojaLoja).toBeUndefined();
    expect(doCd?.quantidadeSugerida).toBe(15);
    expect(doCd?.prioridadeOrigem).toBe(1);
  });

  it("CD/Site parcial: cobre o que tiver, loja cobre só o restante — nunca os 15 inteiros da loja", () => {
    const leblon = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 15, vendasDias90: 40 });
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    // CD com só 3 un. disponíveis acima do próprio mínimo (estoqueMinimo alto o suficiente pra
    // deixar pouca sobra) — cobre só uma parte, o resto tem que vir da loja.
    const cdSite = cd({
      estoqueAtual: 13,
      estoqueMinimo: 9,
      vendasDias30: 10,
      vendasDias90: 30,
      velocidadeDiaria: 10 / 30,
      coberturaDias: 39,
    });
    const { movimentacoes } = calcularMovimentacoes([leblon, rioSul, cdSite], contextoMov());
    const doCd = movimentacoes.find((m) => m.tipoMovimentacao === "cd_site_loja");
    const lojaLoja = movimentacoes.find((m) => m.tipoMovimentacao === "loja_loja");
    expect(doCd?.quantidadeSugerida).toBe(3);
    expect(doCd?.prioridadeOrigem).toBe(1);
    expect(lojaLoja?.quantidadeSugerida).toBe(12);
    expect(lojaLoja?.prioridadeOrigem).toBe(2);
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

  it("recolhe quando há demanda local baixa E grade quebrada (sem precisar de venda online)", () => {
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    const cdSite = cd({ estoqueAtual: 30, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 90 });
    const { movimentacoes } = calcularMovimentacoes(
      [rioSul, cdSite],
      contextoMov({ vendasSite90: 0, gradePorPosicao: { "rio-sul": grade(1, 3) } })
    );
    expect(movimentacoes).toHaveLength(1);
    expect(movimentacoes[0].tipoMovimentacao).toBe("loja_cd_site");
    expect(movimentacoes[0].justificativa.join(" ")).toContain("Grade quebrada");
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

  // Esse teste mudou de propósito em 2026-11-13 (consequência esperada, não bug, da correção de
  // prioridade): antes a redistribuição loja→loja rodava ANTES do CD e consumia o estoque de Rio
  // Sul inteiro pra cobrir Leblon, então Rio Sul nunca era candidato a recolhimento. Com o CD como
  // prioridade 1, ele cobre a necessidade de Leblon sozinho (30 disponível ≫ 15 necessários) —
  // Rio Sul deixa de ser necessário pra cobrir ninguém, e seu excesso (que já tinha os 3 sinais de
  // recolhimento: demanda local baixa, grade quebrada, potencial online) é corretamente recolhido
  // pro CD/Site. O teste de "peça reservada pra outra loja não é recolhida" continua existindo,
  // só com um cenário onde o CD É insuficiente (ver teste seguinte) — é aí que a loja realmente
  // segue sendo necessária.
  it("CD cobrindo a necessidade da loja sozinho libera a sobra de outra loja para recolhimento", () => {
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    const leblon = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 15, vendasDias90: 40 });
    const cdSite = cd({ estoqueAtual: 30, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 90 });
    const { movimentacoes } = calcularMovimentacoes(
      [rioSul, leblon, cdSite],
      contextoMov({ vendasSite90: 99, gradePorPosicao: { "rio-sul": grade(1, 3) } })
    );
    expect(movimentacoes.find((m) => m.tipoMovimentacao === "loja_loja")).toBeUndefined();
    expect(movimentacoes.find((m) => m.tipoMovimentacao === "cd_site_loja")).toMatchObject({
      destinoNome: "Leblon",
      quantidadeSugerida: 15,
      prioridadeOrigem: 1,
    });
    expect(movimentacoes.find((m) => m.tipoMovimentacao === "loja_cd_site")).toMatchObject({
      origemNome: "Rio Sul",
      quantidadeSugerida: 12,
    });
  });

  it("peça já redistribuída pra outra loja (CD insuficiente) não é oferecida de novo pra recolhimento", () => {
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    const leblon = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 15, vendasDias90: 40 });
    // CD com pouca sobra (3 un.) — insuficiente pra cobrir Leblon sozinho, então Rio Sul segue
    // sendo necessário pra cobrir o restante e não pode ser oferecido pra recolhimento também.
    const cdSite = cd({
      estoqueAtual: 13,
      estoqueMinimo: 9,
      vendasDias30: 10,
      vendasDias90: 30,
      velocidadeDiaria: 10 / 30,
      coberturaDias: 39,
    });
    const { movimentacoes } = calcularMovimentacoes(
      [rioSul, leblon, cdSite],
      contextoMov({ vendasSite90: 99, gradePorPosicao: { "rio-sul": grade(1, 3) } })
    );
    expect(movimentacoes.filter((m) => m.tipoMovimentacao === "loja_cd_site")).toHaveLength(0);
    expect(movimentacoes.find((m) => m.origemNome === "Rio Sul")).toMatchObject({
      tipoMovimentacao: "loja_loja",
      destinoNome: "Leblon",
      quantidadeSugerida: 12,
      prioridadeOrigem: 2,
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

// ---------------------------------------------------------------------------
// PRIORIDADE DE ORIGEM: CD > LOJAS > PRODUÇÃO (correção comercial pedida pelo Rodrigo, 2026-11-13)
// ---------------------------------------------------------------------------
describe("calcularMovimentacoes — hierarquia de prioridade CD > lojas > produção (2026-11-13)", () => {
  // Reproduz literalmente o exemplo obrigatório do pedido: CD com 8 un., Loja A precisa 5, Loja B
  // precisa 4, Loja C tem excedente de 6. Resultado esperado: CD→A 5, CD→B 3 (resto do CD), C→B 1
  // (resto da necessidade de B), zero C→A, e nenhuma necessidade não atendida (3 do CD + 1 de C
  // cobrem os 4 de B por completo).
  it("exemplo obrigatório do pedido: CD 8un, A precisa 5, B precisa 4, C excedente 6", () => {
    const lojaA = variante({ storeId: "loja-a", storeName: "Loja A", estoqueAtual: 0, vendasDias30: 5, vendasDias90: 15 });
    const lojaB = variante({ storeId: "loja-b", storeName: "Loja B", estoqueAtual: 0, vendasDias30: 4, vendasDias90: 12 });
    const lojaC = variante({ storeId: "loja-c", storeName: "Loja C", estoqueAtual: 6, vendasDias30: 0, vendasDias90: 0 });
    const cdSite = cd({ estoqueAtual: 8, vendasDias30: 0, vendasDias90: 0 });

    const { movimentacoes, necessidadesNaoAtendidas } = calcularMovimentacoes(
      [lojaA, lojaB, lojaC, cdSite],
      contextoMov()
    );

    const doCdParaA = movimentacoes.find((m) => m.tipoMovimentacao === "cd_site_loja" && m.destinoNome === "Loja A");
    const doCdParaB = movimentacoes.find((m) => m.tipoMovimentacao === "cd_site_loja" && m.destinoNome === "Loja B");
    const deCparaB = movimentacoes.find((m) => m.tipoMovimentacao === "loja_loja" && m.origemNome === "Loja C" && m.destinoNome === "Loja B");
    const deCparaA = movimentacoes.find((m) => m.origemNome === "Loja C" && m.destinoNome === "Loja A");

    expect(doCdParaA?.quantidadeSugerida).toBe(5);
    expect(doCdParaB?.quantidadeSugerida).toBe(3);
    expect(deCparaB?.quantidadeSugerida).toBe(1);
    expect(deCparaA).toBeUndefined(); // nunca C→A
    // Nenhuma origem recebeu mais do que tinha disponível.
    expect((doCdParaA?.quantidadeSugerida ?? 0) + (doCdParaB?.quantidadeSugerida ?? 0)).toBeLessThanOrEqual(8);
    // B ficou 100% atendido (3 do CD + 1 de C = 4) — sem necessidade de produção neste exemplo.
    expect(necessidadesNaoAtendidas).toHaveLength(0);
  });

  // Cenário 1: CD suficiente — abastecimento exclusivamente pelo CD, zero loja→loja.
  it("1. CD suficiente: abastece sozinho, zero transferência loja→loja", () => {
    const leblon = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 15, vendasDias90: 40 });
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    const cdSite = cd({ estoqueAtual: 100, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 300 });
    const { movimentacoes } = calcularMovimentacoes([leblon, rioSul, cdSite], contextoMov());
    expect(movimentacoes.find((m) => m.tipoMovimentacao === "loja_loja")).toBeUndefined();
    expect(movimentacoes.find((m) => m.tipoMovimentacao === "cd_site_loja")?.quantidadeSugerida).toBe(15);
  });

  // Cenário 2: CD parcialmente suficiente — cobre primeiro, loja cobre só o restante.
  it("2. CD parcial: cobre o que tiver primeiro, loja cobre só o restante", () => {
    const leblon = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 15, vendasDias90: 40 });
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    const cdSite = cd({ estoqueAtual: 13, estoqueMinimo: 9, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 39 });
    const { movimentacoes } = calcularMovimentacoes([leblon, rioSul, cdSite], contextoMov());
    expect(movimentacoes.find((m) => m.tipoMovimentacao === "cd_site_loja")?.quantidadeSugerida).toBe(3);
    expect(movimentacoes.find((m) => m.tipoMovimentacao === "loja_loja")?.quantidadeSugerida).toBe(12);
  });

  // Cenário 3: CD zerado (ruptura) — procura excedente em outras lojas.
  it("3. CD zerado: sem o que doar, procura excedente nas lojas", () => {
    const leblon = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 15, vendasDias90: 40 });
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 20 });
    const cdSite = cd({ estoqueAtual: 0, vendasDias30: 5, vendasDias90: 20 }); // ruptura: nada a doar
    const { movimentacoes, necessidadesNaoAtendidas } = calcularMovimentacoes([leblon, rioSul, cdSite], contextoMov());
    expect(movimentacoes.find((m) => m.tipoMovimentacao === "cd_site_loja")).toBeUndefined();
    expect(movimentacoes.find((m) => m.tipoMovimentacao === "loja_loja")).toMatchObject({
      origemNome: "Rio Sul",
      destinoNome: "Leblon",
      quantidadeSugerida: 15,
      prioridadeOrigem: 2,
    });
    expect(necessidadesNaoAtendidas).toHaveLength(0);
  });

  // Cenário 4 + 7: CD e lojas sem disponibilidade -> sinaliza necessidade de produção, sem
  // inventar disponibilidade futura (a função não consulta ProductionOrder nem nenhuma previsão —
  // é estrutural, não um valor que este teste possa forçar a aparecer errado).
  it("4/7. CD e lojas sem disponibilidade: sinaliza necessidade de produção, nunca inventa disponibilidade", () => {
    const leblon = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 15, vendasDias90: 40 });
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 0, vendasDias90: 0 }); // sem sobra nenhuma
    const cdSite = cd({ estoqueAtual: 0, vendasDias30: 5, vendasDias90: 20 }); // ruptura
    const { movimentacoes, necessidadesNaoAtendidas } = calcularMovimentacoes([leblon, rioSul, cdSite], contextoMov());
    expect(movimentacoes).toHaveLength(0);
    expect(necessidadesNaoAtendidas).toHaveLength(1);
    expect(necessidadesNaoAtendidas[0]).toMatchObject({ posicaoNome: "Leblon", necessidadeRestante: 15 });
  });

  // Cenário 5: duas lojas disputando o mesmo estoque do CD — sem dupla alocação, soma nunca
  // excede o disponível na origem (reforça o exemplo obrigatório acima com um 3º concorrente).
  it("5. três lojas disputando o CD: soma alocada nunca excede o disponível, sem dupla alocação", () => {
    const a = variante({ storeId: "a", storeName: "A", estoqueAtual: 0, vendasDias30: 5, vendasDias90: 15 });
    const b = variante({ storeId: "b", storeName: "B", estoqueAtual: 0, vendasDias30: 4, vendasDias90: 12 });
    const c = variante({ storeId: "c", storeName: "C", estoqueAtual: 0, vendasDias30: 10, vendasDias90: 30 });
    const cdSite = cd({ estoqueAtual: 8, vendasDias30: 0, vendasDias90: 0 }); // só 8, insuficiente pras 3
    const { movimentacoes } = calcularMovimentacoes([a, b, c, cdSite], contextoMov());
    const doCd = movimentacoes.filter((m) => m.tipoMovimentacao === "cd_site_loja");
    const somaDoCd = doCd.reduce((s, m) => s + m.quantidadeSugerida, 0);
    expect(somaDoCd).toBeLessThanOrEqual(8);
    // Cada loja recebe de no máximo 1 movimentação do CD pra este cod (sem duplicar a mesma
    // unidade pra dois destinos).
    const destinosComMovCd = doCd.map((m) => m.destinoNome);
    expect(new Set(destinosComMovCd).size).toBe(destinosComMovCd.length);
  });

  // Cenário 6: estoque reservado/comprometido não é oferecido. GAP DE DADO CONHECIDO (mesmo do
  // cabeçalho do arquivo): StockSnapshot não tem campo reservado/comprometido real — o proxy que
  // já existe no motor é o próprio StockMinimumRule + margem de segurança (construirOrigem), que
  // nunca deixa a origem oferecer abaixo do que ela mesma precisa guardar.
  it("6. estoque abaixo do próprio mínimo (proxy de comprometido) nunca é oferecido pra transferência", () => {
    const leblon = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 15, vendasDias90: 40 });
    const cdNoMinimo = cd({ estoqueAtual: 50, estoqueMinimo: 50, vendasDias30: 0, vendasDias90: 0 });
    const rioSulNoMinimo = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 10, estoqueMinimo: 10 });
    const { movimentacoes } = calcularMovimentacoes([leblon, rioSulNoMinimo, cdNoMinimo], contextoMov());
    expect(movimentacoes).toHaveLength(0);
  });

  // Cenário 8: múltiplos produtos/tamanhos são independentes — calcularMovimentacoes é pura e não
  // muta as VariantePorLoja de entrada (só os wrappers internos de OrigemAlocavel/DestinoAlocavel),
  // então duas chamadas com o MESMO array de posições mas CONTEXTOS (cods) diferentes nunca vazam
  // quantidade de uma chamada pra outra.
  it("8. múltiplos produtos (cods diferentes) calculados independentemente, sem vazar estoque entre chamadas", () => {
    const leblon = variante({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 15, vendasDias90: 40 });
    const cdSite = cd({ estoqueAtual: 100, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 300 });
    const variantes = [leblon, cdSite];
    const resultado1 = calcularMovimentacoes(variantes, contextoMov({ cod: "COD-A" }));
    const resultado2 = calcularMovimentacoes(variantes, contextoMov({ cod: "COD-B" }));
    expect(resultado1.movimentacoes[0]?.quantidadeSugerida).toBe(15);
    expect(resultado2.movimentacoes[0]?.quantidadeSugerida).toBe(15);
    expect(resultado1.movimentacoes[0]?.cod).toBe("COD-A");
    expect(resultado2.movimentacoes[0]?.cod).toBe("COD-B");
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
    const rioSul = variante({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 12 });
    const cdSite = cd({ estoqueAtual: 30, vendasDias30: 10, vendasDias90: 30, velocidadeDiaria: 10 / 30, coberturaDias: 90 });
    const { movimentacoes } = calcularMovimentacoes(
      [rioSul, cdSite],
      contextoMov({ vendasSite90: 0, gradePorPosicao: { "rio-sul": grade(1, 3) } })
    );
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
