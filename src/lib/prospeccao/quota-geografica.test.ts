import { describe, expect, it } from "vitest";
import { aplicarQuotaGeografica, limiteQuotaMunicipio, QUOTA_CAPITAL_ESTADUAL, QUOTA_PADRAO_MUNICIPIO } from "./quota-geografica";

describe("limiteQuotaMunicipio", () => {
  it("é 2 por padrão para município do interior", () => {
    expect(limiteQuotaMunicipio("RJ", "Niterói")).toBe(QUOTA_PADRAO_MUNICIPIO);
    expect(limiteQuotaMunicipio("RJ", "Niterói")).toBe(2);
  });

  it("é 5 (substitui, não soma) para capital estadual", () => {
    expect(limiteQuotaMunicipio("RJ", "Rio de Janeiro")).toBe(QUOTA_CAPITAL_ESTADUAL);
    expect(limiteQuotaMunicipio("RJ", "Rio de Janeiro")).toBe(5);
    // Nunca 2 + 5 = 7: é substituição.
    expect(limiteQuotaMunicipio("RJ", "Rio de Janeiro")).not.toBe(QUOTA_PADRAO_MUNICIPIO + QUOTA_CAPITAL_ESTADUAL);
  });
});

describe("aplicarQuotaGeografica", () => {
  it("aprova só até o limite por município, ordenando por score desc", () => {
    const candidatos = [
      { id: "a", uf: "RJ", municipio: "Niterói", score: 90 },
      { id: "b", uf: "RJ", municipio: "Niterói", score: 95 },
      { id: "c", uf: "RJ", municipio: "Niterói", score: 80 },
    ];
    const resultado = aplicarQuotaGeografica(candidatos);
    expect(resultado.aprovados).toEqual(["b", "a"]);
    expect(resultado.excedentesPorCota).toEqual(["c"]);
    expect(resultado.porMunicipio[0]).toMatchObject({ limite: 2, qualificados: 3, aprovados: 2 });
  });

  it("aprova até 5 numa capital estadual", () => {
    const candidatos = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      uf: "RJ",
      municipio: "Rio de Janeiro",
      score: 100 - i,
    }));
    const resultado = aplicarQuotaGeografica(candidatos);
    expect(resultado.aprovados).toHaveLength(5);
    expect(resultado.excedentesPorCota).toEqual(["p5"]);
  });

  it("município sem nenhum candidato simplesmente não aparece no resultado — zero não é bug", () => {
    const resultado = aplicarQuotaGeografica([]);
    expect(resultado.aprovados).toEqual([]);
    expect(resultado.excedentesPorCota).toEqual([]);
    expect(resultado.porMunicipio).toEqual([]);
  });

  it("nunca preenche a cota: município com 1 só candidato aprova 1, não inventa um segundo", () => {
    const resultado = aplicarQuotaGeografica([{ id: "unico", uf: "SP", municipio: "Campinas", score: 76 }]);
    expect(resultado.aprovados).toEqual(["unico"]);
    expect(resultado.porMunicipio[0]).toMatchObject({ limite: 2, qualificados: 1, aprovados: 1 });
  });

  it("trata municípios diferentes de forma independente", () => {
    const candidatos = [
      { id: "a", uf: "RJ", municipio: "Niterói", score: 80 },
      { id: "b", uf: "SP", municipio: "Campinas", score: 80 },
    ];
    const resultado = aplicarQuotaGeografica(candidatos);
    expect(resultado.aprovados.sort()).toEqual(["a", "b"]);
  });
});
