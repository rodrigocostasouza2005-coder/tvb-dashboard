import { describe, it, expect } from "vitest";
import { classificarSituacaoTamanho, construirInsights, type LinhaGradeTamanho } from "../mapa-compras-visao-analitica";

describe("classificarSituacaoTamanho — limiares documentados no topo do módulo", () => {
  it("estoque zero com demanda real (ideal > 0) -> ruptura", () => {
    expect(classificarSituacaoTamanho(0, 100)).toBe("ruptura");
  });

  it("estoque bem abaixo do ideal (razão < 0.8) -> ruptura", () => {
    expect(classificarSituacaoTamanho(50, 100)).toBe("ruptura");
  });

  it("estoque levemente abaixo do ideal (0.8 <= razão < 0.95) -> ajustar", () => {
    expect(classificarSituacaoTamanho(85, 100)).toBe("ajustar");
  });

  it("estoque próximo do ideal (0.95 a 1.5) -> equilíbrio", () => {
    expect(classificarSituacaoTamanho(100, 100)).toBe("equilibrio");
    expect(classificarSituacaoTamanho(140, 100)).toBe("equilibrio");
  });

  it("estoque muito acima do ideal (razão > 1.5) -> excesso", () => {
    expect(classificarSituacaoTamanho(200, 100)).toBe("excesso");
  });

  it("sem ideal calculável (ideal = 0) e com estoque -> excesso (parado, sem demanda)", () => {
    expect(classificarSituacaoTamanho(10, 0)).toBe("excesso");
  });

  it("sem ideal calculável e sem estoque -> equilíbrio (nada a fazer, não é problema)", () => {
    expect(classificarSituacaoTamanho(0, 0)).toBe("equilibrio");
  });
});

function linha(over: Partial<LinhaGradeTamanho> = {}): LinhaGradeTamanho {
  return {
    tamanho: "40",
    vendaHistorica: 0,
    participacaoPct: 0,
    estoqueAtual: 0,
    estoqueIdeal: 0,
    deficit: 0,
    excesso: 0,
    compraSugerida: 0,
    situacao: "equilibrio",
    ...over,
  };
}

describe("construirInsights — baseado em regra, nunca texto solto (seção 5.6)", () => {
  it("recorte vazio -> nenhum insight (não inventa texto sem dado)", () => {
    expect(construirInsights({ porTamanho: [], nomeEscopo: "Camisas" })).toEqual([]);
  });

  it("identifica o tamanho mais representativo da demanda", () => {
    const insights = construirInsights({
      porTamanho: [linha({ tamanho: "38", vendaHistorica: 20, participacaoPct: 0.2 }), linha({ tamanho: "40", vendaHistorica: 80, participacaoPct: 0.8 })],
      nomeEscopo: "Camisas",
    });
    expect(insights.some((i) => i.includes("tamanho 40") && i.includes("80%"))).toBe(true);
  });

  it("sinaliza excesso no tamanho com maior volume de sobra", () => {
    const insights = construirInsights({
      porTamanho: [linha({ tamanho: "36", situacao: "excesso", excesso: 18 }), linha({ tamanho: "38", situacao: "excesso", excesso: 5 })],
      nomeEscopo: "Camisas",
    });
    expect(insights.some((i) => i.includes("tamanho 36") && i.includes("18 unidades"))).toBe(true);
  });

  it("sem nenhum tamanho em ruptura/ajuste -> insight de grade equilibrada", () => {
    const insights = construirInsights({ porTamanho: [linha({ situacao: "equilibrio" })], nomeEscopo: "Camisas" });
    expect(insights.some((i) => i.includes("equilibrada"))).toBe(true);
  });

  it("com tamanhos em ruptura/ajuste -> conta quantos, não lista genérico vazio", () => {
    const insights = construirInsights({
      porTamanho: [linha({ situacao: "ruptura" }), linha({ tamanho: "42", situacao: "ajustar" }), linha({ tamanho: "44", situacao: "equilibrio" })],
      nomeEscopo: "Camisas",
    });
    expect(insights.some((i) => i.includes("2 tamanho"))).toBe(true);
  });

  it("concentra o insight de compra sugerida nos top 3 tamanhos por quantidade", () => {
    const insights = construirInsights({
      porTamanho: [
        linha({ tamanho: "38", compraSugerida: 50 }),
        linha({ tamanho: "40", compraSugerida: 100 }),
        linha({ tamanho: "42", compraSugerida: 30 }),
        linha({ tamanho: "44", compraSugerida: 5 }),
      ],
      nomeEscopo: "Camisas",
    });
    const insightCompra = insights.find((i) => i.includes("compra sugerida"));
    expect(insightCompra).toBeDefined();
    expect(insightCompra).toContain("40");
    expect(insightCompra).toContain("38");
    expect(insightCompra).toContain("42");
  });

  it("sem nenhuma compra sugerida (tudo zerado) -> não gera insight de concentração", () => {
    const insights = construirInsights({ porTamanho: [linha({ compraSugerida: 0 })], nomeEscopo: "Camisas" });
    expect(insights.some((i) => i.includes("compra sugerida está concentrada"))).toBe(false);
  });
});
