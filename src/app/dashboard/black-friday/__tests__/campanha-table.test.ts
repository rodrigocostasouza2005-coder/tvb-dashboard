import { describe, it, expect } from "vitest";
import { badgeAtivoPausado } from "../campanha-table";

// 2026-11-06, segunda rodada: Rodrigo pediu o selo Ativo/Pausado de volta (PR #56), mostrando
// todos os conjuntos/anúncios (não só os ativos, ao contrário do que o PR #58 tinha feito).
// 2026-11-09: Rodrigo pediu visibilidade pra anúncio com várias cópias (ids) em campanhas
// diferentes e status misto — virou contagem (AtivoStatus), não mais um booleano puro.
// Cobre a decisão visual pura — o componente em si não tem teste de render (repo sem
// jsdom/testing-library, ver vitest.config.ts).
describe("badgeAtivoPausado — decisão de cor/rótulo do selo por linha", () => {
  it("tudo ativo (ativos === total): ponto status-good, rótulo Ativo, sem contagem", () => {
    expect(badgeAtivoPausado({ ativos: 1, total: 1 })).toEqual({ cor: "var(--status-good)", label: "Ativo" });
    expect(badgeAtivoPausado({ ativos: 3, total: 3 })).toEqual({ cor: "var(--status-good)", label: "Ativo" });
  });

  it("tudo pausado (ativos === 0): ponto muted, rótulo Pausado", () => {
    expect(badgeAtivoPausado({ ativos: 0, total: 1 })).toEqual({ cor: "var(--text-muted)", label: "Pausado" });
    expect(badgeAtivoPausado({ ativos: 0, total: 3 })).toEqual({ cor: "var(--text-muted)", label: "Pausado" });
  });

  it("misto (0 < ativos < total): ponto status-warning, rótulo com a contagem — nunca escondido atrás de um 'Ativo' liso", () => {
    expect(badgeAtivoPausado({ ativos: 1, total: 3 })).toEqual({ cor: "var(--status-warning)", label: "Ativo em 1/3" });
    expect(badgeAtivoPausado({ ativos: 2, total: 3 })).toEqual({ cor: "var(--status-warning)", label: "Ativo em 2/3" });
  });

  it("nome ausente do Map de status (undefined) cai no mesmo visual de Pausado", () => {
    expect(badgeAtivoPausado(undefined)).toEqual({ cor: "var(--text-muted)", label: "Pausado" });
  });
});
