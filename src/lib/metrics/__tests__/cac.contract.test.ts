import { describe, it, expect } from "vitest";
import * as cac from "../cac";

// ============================================================================
// CAC — teste de CONTRATO (não de comportamento: cobertura comportamental completa já existe em
// cac.test.ts, escrita pelo agente que implementou o módulo). Este arquivo só confirma que a
// superfície pública exposta é a que o resto do Radar (Central Black Friday) vai consumir, e que
// a limitação de "CAC por campanha" continua sendo reportada explicitamente, nunca inventada.
// ============================================================================

describe("cac.ts — superfície pública", () => {
  it("expõe as funções que a Central Black Friday vai consumir", () => {
    expect(cac.getEcommerceStoreId).toBeTypeOf("function");
    expect(cac.getInvestimentoAquisicao).toBeTypeOf("function");
    expect(cac.getCacEcommerce).toBeTypeOf("function");
    expect(cac.getCacEvolucaoMensal).toBeTypeOf("function");
    expect(cac.getCacPorCampanha).toBeTypeOf("function");
  });

  it("CAC por campanha continua explicitamente indisponível (nunca inventa atribuição)", () => {
    const resultado = cac.getCacPorCampanha();
    expect(resultado.disponivel).toBe(false);
    expect(resultado.motivo).toMatch(/utm|atribuição|click_id/i);
  });
});
