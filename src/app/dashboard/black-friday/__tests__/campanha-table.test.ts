import { describe, it, expect } from "vitest";
import { badgeAtivoPausado } from "../campanha-table";

// 2026-11-06, segunda rodada: Rodrigo pediu o selo Ativo/Pausado de volta (PR #56), mostrando
// todos os conjuntos/anúncios (não só os ativos, ao contrário do que o PR #58 tinha feito).
// Cobre a decisão visual pura — o componente em si não tem teste de render (repo sem
// jsdom/testing-library, ver vitest.config.ts).
describe("badgeAtivoPausado — decisão de cor/rótulo do selo por linha", () => {
  it("ativo: ponto status-good, rótulo Ativo", () => {
    expect(badgeAtivoPausado(true)).toEqual({ cor: "var(--status-good)", label: "Ativo" });
  });

  it("pausado: ponto muted, rótulo Pausado", () => {
    expect(badgeAtivoPausado(false)).toEqual({ cor: "var(--text-muted)", label: "Pausado" });
  });

  it("nome ausente do Map de status (undefined) cai no mesmo visual de Pausado", () => {
    expect(badgeAtivoPausado(undefined)).toEqual({ cor: "var(--text-muted)", label: "Pausado" });
  });
});
