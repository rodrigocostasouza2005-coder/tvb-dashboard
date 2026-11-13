import { describe, it, expect } from "vitest";
import { resolveSellThrough } from "../estoque";

describe("resolveSellThrough", () => {
  it("vendido=0 e estoque>0 -> null (não é 0%, é sem histórico) — bug relatado pelo Rodrigo em 2026-11-13", () => {
    expect(resolveSellThrough(0, 100, 0)).toBeNull();
  });

  it("vendido=0, estoque>0 e produzido>0 -> null mesmo pela via do cálculo por produção", () => {
    expect(resolveSellThrough(0, 100, 50)).toBeNull();
  });

  it("vendido=0 e estoque=0 -> continua null (já era antes da correção)", () => {
    expect(resolveSellThrough(0, 0, 0)).toBeNull();
  });

  it("vendido>0 sem produzido confiável -> cálculo por estoque, inalterado", () => {
    expect(resolveSellThrough(30, 70, 0)).toBe(30);
  });

  it("vendido>0 com produzido>=vendido -> cálculo por produção, inalterado", () => {
    expect(resolveSellThrough(30, 70, 60)).toBe(50);
  });

  it("vendido>0 com produzido<vendido -> cai pro cálculo por estoque (produzido não confiável), inalterado", () => {
    expect(resolveSellThrough(30, 70, 10)).toBe(30);
  });

  it("vendido>0 com produzido==vendido -> 100%, inalterado", () => {
    expect(resolveSellThrough(40, 10, 40)).toBe(100);
  });
});
