import { describe, it, expect } from "vitest";
import {
  isWithinAutomaticWindow,
  resolveBannerVisibility,
  defaultFiltroBlackFridayStrPura,
  BANNER_INICIO_BRT,
  BANNER_FIM_BRT,
} from "../black-friday-banner";

describe("janela automática do banner Black Friday", () => {
  it("instantes fixos correspondem a 06:00 em Brasília (09:00 UTC), não meia-noite UTC ingênua", () => {
    expect(BANNER_INICIO_BRT.toISOString()).toBe("2026-11-10T09:00:00.000Z");
    expect(BANNER_FIM_BRT.toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });

  it("fica oculto antes de 2026-11-10 06:00 BRT", () => {
    // 1ms antes do início.
    expect(isWithinAutomaticWindow(new Date(BANNER_INICIO_BRT.getTime() - 1))).toBe(false);
    // Bem antes (hoje, 2026-11-05).
    expect(isWithinAutomaticWindow(new Date("2026-11-05T12:00:00.000-03:00"))).toBe(false);
  });

  it("entra exatamente às 2026-11-10 06:00 BRT (inclusive)", () => {
    expect(isWithinAutomaticWindow(BANNER_INICIO_BRT)).toBe(true);
    expect(isWithinAutomaticWindow(new Date("2026-11-10T06:00:00.000-03:00"))).toBe(true);
  });

  it("fica visível em algum ponto do meio do período (ex: 20/11 meio-dia BRT)", () => {
    expect(isWithinAutomaticWindow(new Date("2026-11-20T12:00:00.000-03:00"))).toBe(true);
  });

  it("sai exatamente às 2026-12-01 06:00 BRT (exclusive)", () => {
    expect(isWithinAutomaticWindow(new Date(BANNER_FIM_BRT.getTime() - 1))).toBe(true);
    expect(isWithinAutomaticWindow(BANNER_FIM_BRT)).toBe(false);
    expect(isWithinAutomaticWindow(new Date("2026-12-01T06:00:00.000-03:00"))).toBe(false);
  });

  it("continua oculto bem depois do fim (ex: 2026-12-15)", () => {
    expect(isWithinAutomaticWindow(new Date("2026-12-15T12:00:00.000-03:00"))).toBe(false);
  });

  // Confere que a comparação usa o instante UTC real (fixo), não o relógio local ingênuo do
  // dispositivo — testando com um "now" que teria componentes de data diferentes em outro fuso
  // (ex: 2026-11-10T03:00:00Z é ainda 2026-11-10T00:00 em Brasília, antes da janela) pra garantir
  // que não há conversão naive de string de data sem o offset.
  it("compara por instante UTC fixo, não por data-string ingênua no fuso do dispositivo", () => {
    // 2026-11-10T08:59:59Z = 2026-11-10T05:59:59-03:00 — ainda ANTES da janela.
    expect(isWithinAutomaticWindow(new Date("2026-11-10T08:59:59.000Z"))).toBe(false);
    // 2026-11-10T09:00:00Z = 2026-11-10T06:00:00-03:00 — exatamente o início.
    expect(isWithinAutomaticWindow(new Date("2026-11-10T09:00:00.000Z"))).toBe(true);
  });
});

describe("resolveBannerVisibility (override manual vs. janela automática)", () => {
  const dentroDaJanela = new Date("2026-11-20T12:00:00.000-03:00");
  const foraDaJanela = new Date("2026-11-05T12:00:00.000-03:00");

  it("modoManual null respeita a janela automática (fora)", () => {
    expect(resolveBannerVisibility(null, foraDaJanela)).toEqual({
      visible: false,
      label: "Automático (fora do período)",
    });
  });

  it("modoManual null respeita a janela automática (dentro)", () => {
    expect(resolveBannerVisibility(null, dentroDaJanela)).toEqual({
      visible: true,
      label: "Automático (dentro do período)",
    });
  });

  it("modoManual ATIVO força visível mesmo fora da janela (ex: hoje, antes de 10/11)", () => {
    expect(resolveBannerVisibility("ATIVO", foraDaJanela)).toEqual({
      visible: true,
      label: "Forçado ATIVO (manual)",
    });
  });

  it("modoManual INATIVO força oculto mesmo dentro da janela", () => {
    expect(resolveBannerVisibility("INATIVO", dentroDaJanela)).toEqual({
      visible: false,
      label: "Forçado INATIVO (manual)",
    });
  });

  it("modoManual INATIVO depois do fim da janela real não teria efeito prático diferente do automático (não vaza pra sempre)", () => {
    const depoisDoFim = new Date("2026-12-15T12:00:00.000-03:00");
    // Desativando o override (null) depois do fim real, o automático já esconde sozinho.
    expect(resolveBannerVisibility(null, depoisDoFim).visible).toBe(false);
  });
});

// Pedido do Rodrigo (2026-11-06): filtro padrão da Central Black Friday passa a começar sempre
// em 10/11/2026 a partir da data real de início da campanha — antes disso, continua "últimos 30
// dias" como já era.
describe("defaultFiltroBlackFridayStrPura", () => {
  it("antes de 10/11/2026, continua 'últimos 30 dias' (comportamento antigo, sem mudança)", () => {
    const antes = new Date("2026-11-06T12:00:00.000-03:00");
    const { from, to } = defaultFiltroBlackFridayStrPura(antes);
    expect(to).toBe("2026-11-06");
    expect(from).toBe("2026-10-07"); // 30 dias antes de 06/11
  });

  it("exatamente no dia 10/11/2026, já passa a começar fixo em 2026-11-10", () => {
    const { from, to } = defaultFiltroBlackFridayStrPura(new Date("2026-11-10T06:00:00.000-03:00"));
    expect(from).toBe("2026-11-10");
    expect(to).toBe("2026-11-10");
  });

  it("depois de 10/11/2026 (ex: 20/11), from fica fixo em 2026-11-10, to continua rolando com hoje", () => {
    const { from, to } = defaultFiltroBlackFridayStrPura(new Date("2026-11-20T12:00:00.000-03:00"));
    expect(from).toBe("2026-11-10");
    expect(to).toBe("2026-11-20");
  });

  it("bem depois (ex: 2027), from continua fixo em 2026-11-10 — não é um range rolante, é o início real da campanha", () => {
    const { from, to } = defaultFiltroBlackFridayStrPura(new Date("2027-03-01T12:00:00.000-03:00"));
    expect(from).toBe("2026-11-10");
    expect(to).toBe("2027-03-01");
  });
});
