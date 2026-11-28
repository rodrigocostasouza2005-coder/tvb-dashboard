import { describe, it, expect } from "vitest";
import {
  calcularCrescimentoEfetivo,
  calcularMomentum,
  detalharProjecaoGrupo,
  backtestGrupo,
  type PremissasCrescimento,
  type Cenario,
} from "../mapa-compras-crescimento";

function premissas(overrides: Partial<PremissasCrescimento> = {}): PremissasCrescimento {
  return {
    cenarioAtivo: "base",
    presets: { conservador: 5, base: 12, agressivo: 20 },
    ajusteLoja: {},
    ajusteGrupo: {},
    ajusteMensal: {},
    ...overrides,
  };
}

describe("calcularCrescimentoEfetivo — fórmula documentada no topo do módulo", () => {
  it("sem nenhum ajuste cadastrado, usa só o %/ano do cenário ativo", () => {
    const efetivo = calcularCrescimentoEfetivo(premissas(), { mesCalendario: 3 });
    expect(efetivo).toBeCloseTo(0.12, 5); // base = 12%/ano
  });

  it("troca de cenário (sem passar explicitamente) usa o cenarioAtivo das premissas", () => {
    const p = premissas({ cenarioAtivo: "agressivo" });
    const efetivo = calcularCrescimentoEfetivo(p, { mesCalendario: 3 });
    expect(efetivo).toBeCloseTo(0.2, 5);
  });

  it("cenário passado explicitamente sobrepõe o cenarioAtivo das premissas", () => {
    const p = premissas({ cenarioAtivo: "base" });
    const efetivo = calcularCrescimentoEfetivo(p, { mesCalendario: 3 }, "conservador");
    expect(efetivo).toBeCloseTo(0.05, 5);
  });

  it("ajuste de loja é multiplicativo sobre o %/ano do cenário", () => {
    const p = premissas({ ajusteLoja: { "loja-barra": 1.5 } });
    const efetivo = calcularCrescimentoEfetivo(p, { posicaoId: "loja-barra", mesCalendario: 3 });
    expect(efetivo).toBeCloseTo(0.12 * 1.5, 5);
  });

  it("ajuste de grupo é multiplicativo, combinado com ajuste de loja (multiplicadores compostos)", () => {
    const p = premissas({ ajusteLoja: { "loja-barra": 1.5 }, ajusteGrupo: { Bermudas: 1.2 } });
    const efetivo = calcularCrescimentoEfetivo(p, { posicaoId: "loja-barra", grupo: "Bermudas", mesCalendario: 3 });
    expect(efetivo).toBeCloseTo(0.12 * 1.5 * 1.2, 5);
  });

  it("ajuste mensal é ADITIVO em pontos percentuais, não multiplicativo (não comprime os outros ajustes)", () => {
    const p = premissas({ ajusteMensal: { 11: 10 } }); // +10 pontos percentuais em novembro
    const efetivo = calcularCrescimentoEfetivo(p, { mesCalendario: 11 });
    expect(efetivo).toBeCloseTo(0.12 + 0.1, 5);
  });

  it("loja/grupo sem ajuste cadastrado usa multiplicador neutro (1.0), não zero", () => {
    const efetivo = calcularCrescimentoEfetivo(premissas(), { posicaoId: "loja-sem-ajuste", grupo: "grupo-sem-ajuste", mesCalendario: 3 });
    expect(efetivo).toBeCloseTo(0.12, 5);
  });
});

describe("calcularMomentum — tendência recente, capada em [0.8, 1.2]", () => {
  it("sem receita anterior (grupo novo) -> neutro (1), nunca inventa tendência por divisão por zero", () => {
    expect(calcularMomentum(1000, 0)).toBe(1);
  });

  it("crescimento real moderado (20%) fica dentro do cap, preservado exatamente", () => {
    expect(calcularMomentum(1200, 1000)).toBeCloseTo(1.2, 5);
  });

  it("crescimento explosivo (300%, amostra pequena/ruidosa) é capado em 1.2", () => {
    expect(calcularMomentum(4000, 1000)).toBe(1.2);
  });

  it("queda forte (50%) é capada em 0.8, não reflete a queda real inteira", () => {
    expect(calcularMomentum(500, 1000)).toBe(0.8);
  });

  it("receita estável (mesmo valor) -> momentum exatamente 1", () => {
    expect(calcularMomentum(1000, 1000)).toBe(1);
  });
});

describe("detalharProjecaoGrupo — transparência do forecast (seção 12)", () => {
  it("resultado bate com baseComparavel × (1 + crescimentoEfetivo) × momentum", () => {
    const p = premissas({ cenarioAtivo: "base", ajusteGrupo: { Camisas: 1.1 } });
    const detalhe = detalharProjecaoGrupo(p, { grupo: "Camisas", mes: "2026-11", baseComparavel: 10000, momentum: 1.05 });
    const esperado = 10000 * (1 + 0.12 * 1.1) * 1.05;
    expect(detalhe.resultado).toBeCloseTo(esperado, 2);
    expect(detalhe.cenario).toBe("base");
    expect(detalhe.presetCenario).toBe(12);
    expect(detalhe.ajusteGrupo).toBe(1.1);
    expect(detalhe.ajusteLoja).toBeNull(); // sem posicaoId passado
  });

  it("extrai o mês do calendário corretamente de uma string YYYY-MM (ex: dezembro = 12)", () => {
    const p = premissas({ ajusteMensal: { 12: 8 } });
    const detalhe = detalharProjecaoGrupo(p, { grupo: "Qualquer", mes: "2027-12", baseComparavel: 1000, momentum: 1 });
    expect(detalhe.ajusteMensalPontos).toBe(8);
  });

  it("nunca projeta negativo mesmo com crescimento efetivo muito negativo", () => {
    const p = premissas({ cenarioAtivo: "base", ajusteGrupo: { X: -50 } }); // ajuste absurdo de propósito
    const detalhe = detalharProjecaoGrupo(p, { grupo: "X", mes: "2026-06", baseComparavel: 5000, momentum: 1 });
    expect(detalhe.resultado).toBe(0);
  });

  it("com posicaoId informado, ajusteLoja aparece no detalhamento (não fica null)", () => {
    const p = premissas({ ajusteLoja: { "cd-site": 1.3 } });
    const detalhe = detalharProjecaoGrupo(p, { grupo: "Qualquer", mes: "2026-06", baseComparavel: 1000, momentum: 1, posicaoId: "cd-site" });
    expect(detalhe.ajusteLoja).toBe(1.3);
  });
});

describe("backtestGrupo — reaplica a fórmula atual em meses já realizados", () => {
  it("erro percentual é calculado como (previsto - realizado) / realizado", () => {
    const p = premissas({ cenarioAtivo: "base" }); // 12%/ano, sem ajustes
    const pontos = backtestGrupo(p, [{ grupo: "Camisas", mes: "2026-06", baseComparavel: 1000, momentum: 1, realizado: 1100 }]);
    expect(pontos).toHaveLength(1);
    const previsto = 1000 * 1.12; // sem ajustes, momentum 1
    expect(pontos[0].previsto).toBe(Math.round(previsto));
    expect(pontos[0].realizado).toBe(1100);
    expect(pontos[0].erroPct).toBeCloseTo((previsto - 1100) / 1100, 4);
  });

  it("realizado = 0 -> erroPct null (divisão por zero evitada, nunca Infinity/NaN)", () => {
    const pontos = backtestGrupo(premissas(), [{ grupo: "X", mes: "2026-01", baseComparavel: 500, momentum: 1, realizado: 0 }]);
    expect(pontos[0].erroPct).toBeNull();
  });

  it("processa múltiplos pontos independentemente, cada um com seu próprio grupo/mês", () => {
    const pontos = backtestGrupo(premissas(), [
      { grupo: "A", mes: "2026-01", baseComparavel: 1000, momentum: 1, realizado: 1000 },
      { grupo: "B", mes: "2026-02", baseComparavel: 2000, momentum: 1, realizado: 2500 },
    ]);
    expect(pontos).toHaveLength(2);
    expect(pontos[0].mes).toBe("2026-01");
    expect(pontos[1].mes).toBe("2026-02");
  });
});

describe("nomeCenario", () => {
  it("devolve o rótulo correto pros 3 cenários", async () => {
    const { nomeCenario } = await import("../mapa-compras-crescimento");
    const casos: [Cenario, string][] = [
      ["conservador", "Conservador"],
      ["base", "Base"],
      ["agressivo", "Agressivo"],
    ];
    for (const [cenario, esperado] of casos) expect(nomeCenario(cenario)).toBe(esperado);
  });
});
