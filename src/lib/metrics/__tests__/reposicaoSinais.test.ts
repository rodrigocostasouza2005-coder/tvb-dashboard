import { describe, it, expect } from "vitest";
import { construirMapaMinimoManualPorCod, construirMapaTransferenciaPorCodELoja } from "../reposicao-sinais";
import type { ItemMinimoManual } from "../estoque-minimo-manual";
import type { MovimentacaoRecomendada } from "../distribuicao-estoque";

function itemMinimo(overrides: Partial<ItemMinimoManual> = {}): ItemMinimoManual {
  return {
    cod: "COD-1",
    produto: "Camisa Polo",
    grupo: "Polos",
    cor: "Azul",
    tamanho: "M",
    tipoCompra: null,
    minimoDefinido: 10,
    estoqueConsolidado: 5,
    diferenca: -5,
    percentualCobertura: 50,
    velocidadeDiariaConsolidada: 1,
    tempoMedioProducaoDias: null,
    diasAteCruzarMinimo: null,
    nivelAlerta: "CRITICO",
    porLoja: [],
    ...overrides,
  };
}

function movimentacao(overrides: Partial<MovimentacaoRecomendada> = {}): MovimentacaoRecomendada {
  return {
    cod: "COD-1",
    produto: "Camisa Polo",
    grupo: "Polos",
    cor: "Azul",
    tamanho: "M",
    tipoMovimentacao: "cd_site_loja",
    classificacao: "REDISTRIBUIR",
    prioridade: "media",
    confianca: "alta",
    origemPosicaoId: "cd",
    origemNome: "CD/Site",
    destinoPosicaoId: "loja-a",
    destinoNome: "Loja A",
    quantidadeSugerida: 5,
    estoqueOrigemAntes: 20,
    estoqueOrigemDepois: 15,
    estoqueDestinoAntes: 0,
    estoqueDestinoDepois: 5,
    disponivelOrigem: 5,
    coberturaOrigemAntes: 90,
    coberturaOrigemDepois: 60,
    coberturaDestinoAntes: null,
    coberturaDestinoDepois: 20,
    vendasOrigem30: 1,
    vendasOrigem90: 3,
    vendasDestino30: 1,
    vendasDestino90: 3,
    giroOrigemDia: 0.1,
    giroDestinoDia: 0.1,
    justificativa: [],
    impactoEsperado: "",
    avisos: [],
    ...overrides,
  };
}

describe("construirMapaMinimoManualPorCod (pura)", () => {
  it("inclui cod com minimoDefinido preenchido", () => {
    const mapa = construirMapaMinimoManualPorCod([itemMinimo({ cod: "COD-1", minimoDefinido: 10 })]);
    expect(mapa.get("COD-1")?.minimoDefinido).toBe(10);
  });

  it("NUNCA inclui cod com minimoDefinido null (SEM_MINIMO_DEFINIDO) — lookup deve devolver undefined", () => {
    const mapa = construirMapaMinimoManualPorCod([
      itemMinimo({ cod: "COD-SEM-MINIMO", minimoDefinido: null, nivelAlerta: "SEM_MINIMO_DEFINIDO" }),
    ]);
    expect(mapa.has("COD-SEM-MINIMO")).toBe(false);
    expect(mapa.get("COD-SEM-MINIMO")).toBeUndefined();
  });

  it("mistura: só o cod com mínimo definido entra no mapa", () => {
    const mapa = construirMapaMinimoManualPorCod([
      itemMinimo({ cod: "COD-1", minimoDefinido: 10 }),
      itemMinimo({ cod: "COD-2", minimoDefinido: null }),
    ]);
    expect([...mapa.keys()]).toEqual(["COD-1"]);
  });

  it("lista vazia devolve mapa vazio", () => {
    expect(construirMapaMinimoManualPorCod([]).size).toBe(0);
  });
});

describe("construirMapaTransferenciaPorCodELoja (pura)", () => {
  it("casa por cod + loja de destino exatos (chave destinoPosicaoId::cod)", () => {
    const mapa = construirMapaTransferenciaPorCodELoja([
      movimentacao({ cod: "COD-1", destinoPosicaoId: "loja-a", quantidadeSugerida: 7, origemNome: "CD/Site" }),
    ]);
    expect(mapa.get("loja-a::COD-1")).toEqual({ quantidade: 7, origens: ["CD/Site"] });
  });

  it("nunca mistura oportunidade de um tamanho (cod) com outro do mesmo produto — grão é o cod, não o produto", () => {
    const mapa = construirMapaTransferenciaPorCodELoja([
      movimentacao({ cod: "COD-TAM-40", destinoPosicaoId: "loja-a", quantidadeSugerida: 5 }),
      movimentacao({ cod: "COD-TAM-42", destinoPosicaoId: "loja-a", quantidadeSugerida: 9 }),
    ]);
    expect(mapa.get("loja-a::COD-TAM-40")?.quantidade).toBe(5);
    expect(mapa.get("loja-a::COD-TAM-42")?.quantidade).toBe(9);
  });

  it("soma quantidadeSugerida de múltiplas origens pro mesmo destino+cod, sem duplicar nome de origem repetido", () => {
    const mapa = construirMapaTransferenciaPorCodELoja([
      movimentacao({ cod: "COD-1", destinoPosicaoId: "loja-a", origemNome: "CD/Site", quantidadeSugerida: 4 }),
      movimentacao({ cod: "COD-1", destinoPosicaoId: "loja-a", origemNome: "Loja B", quantidadeSugerida: 3 }),
      movimentacao({ cod: "COD-1", destinoPosicaoId: "loja-a", origemNome: "CD/Site", quantidadeSugerida: 2 }),
    ]);
    const sinal = mapa.get("loja-a::COD-1");
    expect(sinal?.quantidade).toBe(9);
    expect(sinal?.origens).toEqual(["CD/Site", "Loja B"]);
  });

  it("ignora oportunidade pro mesmo cod mas loja de destino diferente", () => {
    const mapa = construirMapaTransferenciaPorCodELoja([
      movimentacao({ cod: "COD-1", destinoPosicaoId: "loja-b", quantidadeSugerida: 7 }),
    ]);
    expect(mapa.get("loja-a::COD-1")).toBeUndefined();
  });

  it("nunca inclui quantidadeSugerida <= 0 (guarda defensiva)", () => {
    const mapa = construirMapaTransferenciaPorCodELoja([
      movimentacao({ cod: "COD-1", destinoPosicaoId: "loja-a", quantidadeSugerida: 0 }),
    ]);
    expect(mapa.size).toBe(0);
  });

  it("lista vazia devolve mapa vazio", () => {
    expect(construirMapaTransferenciaPorCodELoja([]).size).toBe(0);
  });
});
