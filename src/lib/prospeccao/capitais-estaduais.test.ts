import { describe, expect, it } from "vitest";
import { CAPITAIS_ESTADUAIS, ehCapitalEstadual, ufValida } from "./capitais-estaduais";

describe("capitais estaduais", () => {
  it("tem exatamente 27 UFs (26 estados + DF)", () => {
    expect(Object.keys(CAPITAIS_ESTADUAIS)).toHaveLength(27);
  });

  it("reconhece a capital mesmo com variação de caixa e acento", () => {
    expect(ehCapitalEstadual("RJ", "rio de janeiro")).toBe(true);
    expect(ehCapitalEstadual("rj", "RIO DE JANEIRO")).toBe(true);
    expect(ehCapitalEstadual("SP", "São Paulo")).toBe(true);
    expect(ehCapitalEstadual("DF", "Brasília")).toBe(true);
  });

  it("não confunde município do interior com a capital", () => {
    expect(ehCapitalEstadual("RJ", "Niterói")).toBe(false);
    expect(ehCapitalEstadual("SP", "Campinas")).toBe(false);
  });

  it("retorna false pra UF desconhecida ou município vazio, sem lançar erro", () => {
    expect(ehCapitalEstadual("ZZ", "Qualquer")).toBe(false);
    expect(ehCapitalEstadual("RJ", null)).toBe(false);
    expect(ehCapitalEstadual("RJ", "")).toBe(false);
  });

  it("valida UF conhecida e rejeita desconhecida", () => {
    expect(ufValida("RJ")).toBe(true);
    expect(ufValida("ZZ")).toBe(false);
    expect(ufValida("rj")).toBe(false);
  });
});
