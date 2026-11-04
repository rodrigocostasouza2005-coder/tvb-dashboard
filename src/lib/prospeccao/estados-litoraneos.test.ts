import { describe, expect, it } from "vitest";
import { ESTADOS_BRASIL } from "./estados-litoraneos";

describe("mapa de prospecção do litoral", () => {
  it("inclui os 27 estados no desenho do Brasil", () => {
    expect(ESTADOS_BRASIL).toHaveLength(27);
    expect(new Set(ESTADOS_BRASIL.map((state) => state.uf)).size).toBe(27);
  });

  it("permite selecionar exatamente os 17 estados com litoral", () => {
    const states = ESTADOS_BRASIL.filter((state) => state.litoraneo).map((state) => state.uf);
    expect(states).toHaveLength(17);
    expect(states).toEqual(expect.arrayContaining(["AP", "PA", "MA", "PI", "CE", "RN", "PB", "PE", "AL", "SE", "BA", "ES", "RJ", "SP", "PR", "SC", "RS"]));
  });

  it("mantém geometria SVG em todos os estados", () => {
    expect(ESTADOS_BRASIL.every((state) => state.path.startsWith("m ") && state.path.length > 100)).toBe(true);
  });
});
