import { describe, it, expect } from "vitest";
import {
  isWithinAutomaticWindow,
  resolveBannerVisibility,
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
