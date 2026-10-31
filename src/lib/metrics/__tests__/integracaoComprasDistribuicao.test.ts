import { describe, it, expect, vi, beforeEach } from "vitest";
import { TipoCompraProduto } from "@prisma/client";
import { combinarRecomendacaoConsolidada } from "../integracao-compras-distribuicao";
import type { ComparacaoVariante, VariantePorLoja, OportunidadeTransferencia } from "../distribuicao-estoque";
import type { ClassificacaoPorProdutoEntry, RecomendacaoBestSellerPorProduto, RecomendacaoDropPorProduto } from "../compras-inteligencia";

function loja(overrides: Partial<VariantePorLoja> = {}): VariantePorLoja {
  return {
    storeId: "leblon",
    storeCode: "LEBLON",
    storeName: "Leblon",
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
}

function variante(overrides: Partial<ComparacaoVariante> = {}): ComparacaoVariante {
  return {
    cod: "COD-1",
    produto: "Camiseta TVB",
    grupo: "Camisetas",
    cor: "Azul",
    tamanho: "M",
    colecao: null,
    porLoja: [loja()],
    ...overrides,
  };
}

function transferencia(overrides: Partial<OportunidadeTransferencia> = {}): OportunidadeTransferencia {
  return {
    cod: "COD-1",
    produto: "Camiseta TVB",
    grupo: "Camisetas",
    cor: "Azul",
    tamanho: "M",
    lojaOrigem: "Rio Sul",
    lojaDestino: "Leblon",
    estoqueOrigemAntes: 12,
    estoqueOrigemDepois: 2,
    estoqueDestinoAntes: 0,
    estoqueDestinoDepois: 10,
    coberturaOrigemAntes: 300,
    coberturaOrigemDepois: 50,
    coberturaDestinoAntes: 0,
    coberturaDestinoDepois: 20,
    quantidadeSugerida: 10,
    justificativa: ["teste"],
    ...overrides,
  };
}

function classificacao(overrides: Partial<ClassificacaoPorProdutoEntry> = {}): ClassificacaoPorProdutoEntry {
  return { tipoCompra: TipoCompraProduto.BEST_SELLER, divergente: false, cods: ["COD-1"], ...overrides };
}

function bestSeller(overrides: Partial<RecomendacaoBestSellerPorProduto> = {}): RecomendacaoBestSellerPorProduto {
  return {
    cod: "COD-1",
    produto: "Camiseta TVB",
    grupo: "Camisetas",
    estoqueDisponivelUtilizavel: 10,
    demandaProjetadaHorizonte: 50,
    coberturaAtualDias: 10,
    recebimentosUtilizaveis: 0,
    quantidadeSugerida: 40,
    valorEstimado: 400,
    confiavel: true,
    premissas: [],
    avisos: [],
    ...overrides,
  };
}

function drop(overrides: Partial<RecomendacaoDropPorProduto> = {}): RecomendacaoDropPorProduto {
  return {
    cod: "COD-1",
    produto: "Bermuda Drop",
    grupo: "Bermudas",
    colecao: "Drop Verão",
    estoqueDisponivel: 5,
    sellThroughAtual: 80,
    previsaoVendaAteFimJanela: 10,
    riscoSobra: false,
    excedenteEstimado: 0,
    riscoRuptura: false,
    faltanteEstimado: 0,
    quantidadeSugerida: 0,
    valorEstimado: 0,
    bloqueadoRecompra: false,
    precisaConfirmacaoHumana: false,
    diasRestantesJanela: 10,
    premissas: [],
    avisos: [],
    ...overrides,
  };
}

const coberturaAlvoDias = 30;

describe("combinarRecomendacaoConsolidada", () => {
  it("necessidade residual = necessidade identificada - quantidade transferível, quando a transferência não cobre tudo", () => {
    // Leblon precisa de 20 (ruptura, vende 2/dia * 30 - 0 estoque = 60... usamos vendasDias30 pra
    // bater exatamente 20 de necessidade: vendasDias30=20 => necessidade = round(20/30*30)-0=20).
    const comp = variante({
      porLoja: [
        loja({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 20, vendasDias90: 60, diagnostico: "ruptura" }),
        loja({ storeId: "rio-sul", storeName: "Rio Sul", estoqueAtual: 50, vendasDias30: 0, vendasDias90: 0, diagnostico: "estoque_parado" }),
      ],
    });
    const oport = [transferencia({ quantidadeSugerida: 12 })]; // só 12 das 20 cobertas
    const cls = new Map([["Camisetas::Camiseta TVB", classificacao()]]);
    const bs = new Map([["COD-1", bestSeller({ quantidadeSugerida: 40, valorEstimado: 400 })]]);

    const [r] = combinarRecomendacaoConsolidada([comp], oport, cls, bs, new Map(), coberturaAlvoDias);

    expect(r.necessidadeIdentificada).toBe(20);
    expect(r.quantidadeTransferivel).toBe(12);
    expect(r.necessidadeResidual).toBe(8);
    expect(r.compraFinalRecomendada).toBe(8);
    expect(r.sugestaoCompraIndependente?.quantidadeSugerida).toBe(40); // número da Compras nunca é sobrescrito
  });

  it("necessidade totalmente coberta por transferência -> residual zero", () => {
    const comp = variante({
      porLoja: [loja({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 10, vendasDias90: 30, diagnostico: "ruptura" })],
    });
    const oport = [transferencia({ quantidadeSugerida: 15 })]; // mais que suficiente
    const cls = new Map([["Camisetas::Camiseta TVB", classificacao()]]);

    const [r] = combinarRecomendacaoConsolidada([comp], oport, cls, new Map(), new Map(), coberturaAlvoDias);
    expect(r.necessidadeResidual).toBe(0);
    expect(r.compraFinalRecomendada).toBe(0);
  });

  it("mínimo de segurança da origem já vem respeitado pela Distribuição — esta camada só soma o que recebeu, não recalcula", () => {
    // Simula uma oportunidade que JÁ foi calculada respeitando o mínimo (origem só doou 3, não os
    // 12 que tinha, porque o restante é o mínimo dela) — a integração deve usar esse número tal
    // como veio, nunca "completar" com o estoque total da origem.
    const comp = variante({
      porLoja: [loja({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 10, vendasDias90: 30, diagnostico: "ruptura" })],
    });
    const oport = [transferencia({ quantidadeSugerida: 3, estoqueOrigemAntes: 12, estoqueOrigemDepois: 9 })];
    const cls = new Map([["Camisetas::Camiseta TVB", classificacao()]]);

    const [r] = combinarRecomendacaoConsolidada([comp], oport, cls, new Map(), new Map(), coberturaAlvoDias);
    expect(r.quantidadeTransferivel).toBe(3);
    expect(r.necessidadeResidual).toBe(10 - 3);
  });

  it("produto com 2 SKUs (cores/tamanhos diferentes) soma necessidade e transferência de cada um, sem misturar com outro produto", () => {
    const compM = variante({
      cod: "COD-M",
      tamanho: "M",
      porLoja: [loja({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 10, vendasDias90: 30, diagnostico: "ruptura" })],
    });
    const compG = variante({
      cod: "COD-G",
      tamanho: "G",
      porLoja: [loja({ storeId: "leblon", storeName: "Leblon", estoqueAtual: 0, vendasDias30: 5, vendasDias90: 15, diagnostico: "ruptura" })],
    });
    // Oportunidade de um produto DIFERENTE (cod não pertence a este produto) não deve contaminar.
    const outroProdutoOport = transferencia({ cod: "COD-OUTRO-PRODUTO", quantidadeSugerida: 999 });
    const oport = [transferencia({ cod: "COD-M", quantidadeSugerida: 4 }), transferencia({ cod: "COD-G", quantidadeSugerida: 2 }), outroProdutoOport];
    const cls = new Map([["Camisetas::Camiseta TVB", classificacao({ cods: ["COD-M", "COD-G"] })]]);

    const [r] = combinarRecomendacaoConsolidada([compM, compG], oport, cls, new Map(), new Map(), coberturaAlvoDias);
    expect(r.necessidadeIdentificada).toBe(10 + 5);
    expect(r.quantidadeTransferivel).toBe(4 + 2); // não inclui os 999 do outro produto
  });

  it("produto sem classificação não entra no resultado (mesma regra da matriz — fila de revisão)", () => {
    const comp = variante({
      porLoja: [loja({ storeId: "leblon", estoqueAtual: 0, vendasDias30: 10, vendasDias90: 30, diagnostico: "ruptura" })],
    });
    const resultado = combinarRecomendacaoConsolidada([comp], [], new Map(), new Map(), new Map(), coberturaAlvoDias);
    expect(resultado).toHaveLength(0);
  });

  it("sem necessidade e sem transferência -> produto não aparece (nunca lista sem evidência)", () => {
    const comp = variante({ porLoja: [loja({ diagnostico: "equilibrado", estoqueAtual: 20, vendasDias30: 20, vendasDias90: 60 })] });
    const cls = new Map([["Camisetas::Camiseta TVB", classificacao()]]);
    const resultado = combinarRecomendacaoConsolidada([comp], [], cls, new Map(), new Map(), coberturaAlvoDias);
    expect(resultado).toHaveLength(0);
  });

  it("não duplica recomendação: múltiplas variantes do mesmo produto geram UMA linha de resultado", () => {
    const compM = variante({ cod: "COD-M", porLoja: [loja({ estoqueAtual: 0, vendasDias30: 10, vendasDias90: 30, diagnostico: "ruptura" })] });
    const compG = variante({ cod: "COD-G", porLoja: [loja({ estoqueAtual: 0, vendasDias30: 5, vendasDias90: 15, diagnostico: "ruptura" })] });
    const cls = new Map([["Camisetas::Camiseta TVB", classificacao({ cods: ["COD-M", "COD-G"] })]]);
    const resultado = combinarRecomendacaoConsolidada([compM, compG], [], cls, new Map(), new Map(), coberturaAlvoDias);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].produto).toBe("Camiseta TVB");
  });

  describe("separação BEST_SELLER / DROP — a integração nunca contorna a regra da classificação", () => {
    it("Drop com recompra bloqueada (possibilidadeReposicao=NAO) -> compraFinalRecomendada é 0, mesmo com necessidade residual real", () => {
      const comp = variante({
        produto: "Bermuda Drop",
        grupo: "Bermudas",
        porLoja: [loja({ storeId: "leblon", estoqueAtual: 0, vendasDias30: 10, vendasDias90: 30, diagnostico: "ruptura" })],
      });
      const cls = new Map([["Bermudas::Bermuda Drop", classificacao({ tipoCompra: TipoCompraProduto.DROP })]]);
      const dropPorCod = new Map([["COD-1", drop({ bloqueadoRecompra: true })]]);

      const [r] = combinarRecomendacaoConsolidada([comp], [], cls, new Map(), dropPorCod, coberturaAlvoDias);
      expect(r.necessidadeResidual).toBeGreaterThan(0);
      expect(r.compraFinalRecomendada).toBe(0);
      expect(r.justificativa.some((j) => j.includes("bloqueada"))).toBe(true);
    });

    it("Drop com possibilidade de reposição A_CONFIRMAR -> compraFinalRecomendada é null (decisão humana pendente)", () => {
      const comp = variante({
        produto: "Bermuda Drop",
        grupo: "Bermudas",
        porLoja: [loja({ storeId: "leblon", estoqueAtual: 0, vendasDias30: 10, vendasDias90: 30, diagnostico: "ruptura" })],
      });
      const cls = new Map([["Bermudas::Bermuda Drop", classificacao({ tipoCompra: TipoCompraProduto.DROP })]]);
      const dropPorCod = new Map([["COD-1", drop({ precisaConfirmacaoHumana: true })]]);

      const [r] = combinarRecomendacaoConsolidada([comp], [], cls, new Map(), dropPorCod, coberturaAlvoDias);
      expect(r.compraFinalRecomendada).toBeNull();
    });

    it("Best Seller nunca lê dados de Drop, e vice-versa (produtos de tipos diferentes não se misturam)", () => {
      const compBS = variante({ cod: "COD-BS", produto: "Camiseta TVB", grupo: "Camisetas", porLoja: [loja({ estoqueAtual: 0, vendasDias30: 10, vendasDias90: 30, diagnostico: "ruptura" })] });
      const compDrop = variante({ cod: "COD-DROP", produto: "Bermuda Drop", grupo: "Bermudas", porLoja: [loja({ estoqueAtual: 0, vendasDias30: 5, vendasDias90: 15, diagnostico: "ruptura" })] });
      const cls = new Map([
        ["Camisetas::Camiseta TVB", classificacao({ cods: ["COD-BS"] })],
        ["Bermudas::Bermuda Drop", classificacao({ tipoCompra: TipoCompraProduto.DROP, cods: ["COD-DROP"] })],
      ]);
      const bsPorCod = new Map([["COD-BS", bestSeller({ cod: "COD-BS" })]]);
      const dropPorCod = new Map([["COD-DROP", drop({ cod: "COD-DROP" })]]);

      const resultado = combinarRecomendacaoConsolidada([compBS, compDrop], [], cls, bsPorCod, dropPorCod, coberturaAlvoDias);
      const bsEntry = resultado.find((r) => r.produto === "Camiseta TVB")!;
      const dropEntry = resultado.find((r) => r.produto === "Bermuda Drop")!;
      expect(bsEntry.tipoCompra).toBe(TipoCompraProduto.BEST_SELLER);
      expect(bsEntry.sugestaoCompraIndependente?.sellThroughAtual).toBeNull(); // campo exclusivo de Drop nunca aparece preenchido no BS
      expect(dropEntry.tipoCompra).toBe(TipoCompraProduto.DROP);
      expect(dropEntry.sugestaoCompraIndependente?.coberturaAtualDias).toBeNull(); // campo exclusivo de BS nunca aparece preenchido no Drop
    });
  });
});

// Seção 7 do pedido: "ausência de dados e falhas de integração" / "falhas de uma inteligência não
// podem interromper a outra" — testado na camada de DADOS (getRecomendacaoConsolidada), não na
// pura, porque é exatamente o Promise.allSettled dessa camada que isola a falha.
const getComparacaoEntreLojasMock = vi.fn();
const getOportunidadesTransferenciaMock = vi.fn();
vi.mock("../distribuicao-estoque", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../distribuicao-estoque")>();
  return {
    ...actual,
    getComparacaoEntreLojas: (...a: unknown[]) => getComparacaoEntreLojasMock(...a),
    getOportunidadesTransferencia: (...a: unknown[]) => getOportunidadesTransferenciaMock(...a),
  };
});

const getClassificacaoPorProdutoMock = vi.fn();
const getRecomendacoesBestSellerMock = vi.fn();
const getRecomendacoesDropMock = vi.fn();
vi.mock("../compras-inteligencia", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../compras-inteligencia")>();
  return {
    ...actual,
    getClassificacaoPorProduto: (...a: unknown[]) => getClassificacaoPorProdutoMock(...a),
    getRecomendacoesBestSeller: (...a: unknown[]) => getRecomendacoesBestSellerMock(...a),
    getRecomendacoesDrop: (...a: unknown[]) => getRecomendacoesDropMock(...a),
  };
});

describe("getRecomendacaoConsolidada — resiliência (seção 7: falha de uma inteligência não interrompe a outra)", () => {
  beforeEach(() => {
    getComparacaoEntreLojasMock.mockReset().mockResolvedValue([]);
    getOportunidadesTransferenciaMock.mockReset().mockResolvedValue([]);
    getClassificacaoPorProdutoMock.mockReset().mockResolvedValue(new Map());
    getRecomendacoesBestSellerMock.mockReset().mockResolvedValue([]);
    getRecomendacoesDropMock.mockReset().mockResolvedValue([]);
  });

  it("Distribuição falhando não lança erro pro chamador — devolve lista vazia, sem derrubar a página", async () => {
    getComparacaoEntreLojasMock.mockRejectedValue(new Error("Neon fora do ar"));
    const { getRecomendacaoConsolidada } = await import("../integracao-compras-distribuicao");
    await expect(getRecomendacaoConsolidada()).resolves.toEqual([]);
  });

  it("Compras falhando também não lança erro pro chamador", async () => {
    getRecomendacoesBestSellerMock.mockRejectedValue(new Error("timeout"));
    const { getRecomendacaoConsolidada } = await import("../integracao-compras-distribuicao");
    await expect(getRecomendacaoConsolidada()).resolves.toEqual([]);
  });

  it("as duas pontas funcionando normalmente -> consolida de verdade (sanity check do mock)", async () => {
    getComparacaoEntreLojasMock.mockResolvedValue([
      {
        cod: "COD-1",
        produto: "Camiseta TVB",
        grupo: "Camisetas",
        cor: "Azul",
        tamanho: "M",
        colecao: null,
        porLoja: [loja({ estoqueAtual: 0, vendasDias30: 10, vendasDias90: 30, diagnostico: "ruptura" })],
      },
    ]);
    getClassificacaoPorProdutoMock.mockResolvedValue(new Map([["Camisetas::Camiseta TVB", classificacao()]]));

    const { getRecomendacaoConsolidada } = await import("../integracao-compras-distribuicao");
    const resultado = await getRecomendacaoConsolidada();
    expect(resultado).toHaveLength(1);
    expect(resultado[0].necessidadeIdentificada).toBe(10);
  });
});
