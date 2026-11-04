import { describe, expect, it } from "vitest";
import { avaliarEvidenciasComerciais } from "./avaliacao-comercial";

const evidence = {
  url: "https://lojateste.com.br",
  titulo: "Loja Teste",
  descricao: "Moda masculina e multimarcas",
  texto: "Moda masculina. Loja multimarcas. Trabalhamos com marcas.",
  marcas: ["Reserva", "Aramis"],
  sinaisModaMasculina: ["moda masculina"],
  sinaisMultimarcas: ["loja multimarcas"],
};

describe("avaliação de evidências comerciais", () => {
  it("encaminha para revisão humana apenas com identidade, moda masculina e multimarcas evidenciados", () => {
    const result = avaliarEvidenciasComerciais({
      nomeLoja: "Loja Teste",
      cidade: "Rio de Janeiro",
      confiancaIdentidade: "ALTA",
      evidencia,
      situacaoCadastral: "ATIVA",
    });
    expect(result.situacao).toBe("PRONTA_PARA_REVISAO_HUMANA");
    expect(result.scoreEvidencia).toBe(100);
    expect(result.pendencias).toContain("confirmar se as marcas citadas são efetivamente comercializadas pela loja");
    expect(result.explicacao).toContain("não aprova");
  });

  it("não confunde duas marcas citadas com prova de operação multimarcas", () => {
    const result = avaliarEvidenciasComerciais({
      nomeLoja: "Loja Teste",
      cidade: null,
      confiancaIdentidade: "ALTA",
      evidencia: { ...evidence, sinaisMultimarcas: [] },
      situacaoCadastral: "ATIVA",
    });
    expect(result.multimarcas).toBe("INDICIO_POR_MARCAS");
    expect(result.situacao).toBe("EVIDENCIA_PARCIAL");
  });

  it("não recomenda revisão comercial quando o site não corresponde à loja", () => {
    const result = avaliarEvidenciasComerciais({
      nomeLoja: "Loja Teste",
      cidade: "Rio de Janeiro",
      confiancaIdentidade: "BAIXA",
      evidencia,
      situacaoCadastral: "ATIVA",
    });
    expect(result.situacao).toBe("EVIDENCIA_PARCIAL");
    expect(result.scoreEvidencia).toBe(80);
    expect(result.pendencias[0]).toContain("confirmar se o site pertence");
  });

  it("mantém cadastro inativo como pendência sem transformar isso em score comercial", () => {
    const active = avaliarEvidenciasComerciais({
      nomeLoja: "Loja Teste", cidade: null, confiancaIdentidade: "ALTA", evidencia, situacaoCadastral: "ATIVA",
    });
    const inactive = avaliarEvidenciasComerciais({
      nomeLoja: "Loja Teste", cidade: null, confiancaIdentidade: "ALTA", evidencia, situacaoCadastral: "BAIXADA",
    });
    expect(inactive.scoreEvidencia).toBe(active.scoreEvidencia);
    expect(inactive.pendencias).toContain("revisar situação cadastral: BAIXADA");
  });

  it("não atribui aderência sem conteúdo de site", () => {
    const result = avaliarEvidenciasComerciais({
      nomeLoja: "Loja Teste", cidade: null, confiancaIdentidade: "BAIXA", evidencia: null, situacaoCadastral: null,
    });
    expect(result.situacao).toBe("SITE_NAO_VALIDADO");
    expect(result.scoreEvidencia).toBe(0);
  });
});
