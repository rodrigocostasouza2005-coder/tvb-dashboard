import { describe, expect, it } from "vitest";
import { avaliarProspectoCadastral } from "./avaliacao-cadastral";

const base = {
  nomeFantasia: "LOJA TESTE",
  cnpj: "11222333000181",
  cidade: "RIO DE JANEIRO",
  estado: "RJ",
  telefone: "2122223333",
  email: "CONTATO@LOJA.COM",
  site: null,
  evidenciaUrl: "https://dados.gov.br/cnpj",
  observacoes: "Coleta cadastral Receita Federal — competência 2026-10 | CNAE principal: 4781400",
};

describe("agente de qualificação cadastral", () => {
  it("encaminha cadastro consistente para validação sem inventar grupo A/B/C/D", () => {
    const result = avaliarProspectoCadastral(base);
    expect(result.aptoParaFila).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.agente).toBe("AGENTE_VALIDACAO_TVB");
    expect(result.motivo).toContain("validar loja, multimarcas e moda masculina");
  });

  it("não encaminha nome fantasia ausente", () => {
    const result = avaliarProspectoCadastral({ ...base, nomeFantasia: "NOME COMERCIAL NÃO IDENTIFICADO" });
    expect(result.aptoParaFila).toBe(false);
    expect(result.agente).toBe("AGENTE_PESQUISA_TVB");
  });

  it("não encaminha CNPJ inválido", () => {
    const result = avaliarProspectoCadastral({ ...base, cnpj: "00000000000000" });
    expect(result.aptoParaFila).toBe(false);
  });

  it("não usa CNAE secundário como prova de aderência principal", () => {
    const result = avaliarProspectoCadastral({ ...base, observacoes: "Coleta cadastral Receita Federal | CNAE de moda identificado: 4781400" });
    expect(result.aptoParaFila).toBe(false);
  });

  it("não encaminha sem telefone nem e-mail", () => {
    const result = avaliarProspectoCadastral({ ...base, telefone: null, email: null });
    expect(result.aptoParaFila).toBe(false);
  });
});
