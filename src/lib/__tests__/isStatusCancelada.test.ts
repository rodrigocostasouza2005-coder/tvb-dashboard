import { describe, it, expect } from "vitest";
import { isStatusCancelada } from "../sync-runner";

describe("isStatusCancelada", () => {
  it("reconhece 'Cancelada' e 'Cancelado' (API usa os dois, dependendo do endpoint)", () => {
    expect(isStatusCancelada("Cancelada")).toBe(true);
    expect(isStatusCancelada("Cancelado")).toBe(true);
  });

  it("não marca status normal como cancelado", () => {
    expect(isStatusCancelada("Fechada")).toBe(false);
    expect(isStatusCancelada("Fechado")).toBe(false);
    expect(isStatusCancelada("Aberto")).toBe(false);
  });
});
