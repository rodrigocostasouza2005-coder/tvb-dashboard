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
      nomeLoja: "Loja Teste", cidade: "Rio de Janeiro", confiancaIdentidade: "ALTA",
      evidencia: evidence, situacaoCadastral: "ATIVA",
    });
    expect(result.situacao).toBe("PRONTA_PARA_REVISAO_HUMANA");
    expect(result.scoreEvidencia).toBe(100);
    expect(result.pendencias).not.toContain("confirmar se as marcas citadas são efetivamente comercializadas pela loja");
    expect(result.explicacao).toContain("não aprova");
  });

  it("não confunde duas marcas citadas com prova de operação multimarcas", () => {
    const result = avaliarEvidenciasComerciais({
      nomeLoja: "Loja Teste", cidade: null, confiancaIdentidade: "ALTA",
      evidencia: { ...evidence, sinaisMultimarcas: [] }, situacaoCadastral: "ATIVA",
    });
    expect(result.multimarcas).toBe("INDICIO_POR_MARCAS");
    expect(result.situacao).toBe("EVIDENCIA_PARCIAL");
  });

  it("não recomenda revisão comercial quando o site não corresponde à loja", () => {
    const result = avaliarEvidenciasComerciais({
      nomeLoja: "Loja Teste", cidade: "Rio de Janeiro", confiancaIdentidade: "BAIXA",
      evidencia: evidence, situacaoCadastral: "ATIVA",
    });
    expect(result.situacao).toBe("EVIDENCIA_PARCIAL");
    expect(result.scoreEvidencia).toBe(0);
    expect(result.pendencias[0]).toContain("confirmar se o site pertence");
  });

  it("não encaminha identidade apenas média, mesmo com evidência comercial completa", () => {
    const result = avaliarEvidenciasComerciais({
      nomeLoja: "Loja Teste", cidade: null, confiancaIdentidade: "MEDIA",
      evidencia: evidence, situacaoCadastral: "ATIVA",
    });
    expect(result.situacao).toBe("EVIDENCIA_PARCIAL");
    expect(result.pendencias.join(" ")).toContain("somente confiança ALTA");
  });

  it("mantém cadastro inativo como pendência sem transformar isso em score comercial", () => {
    const active = avaliarEvidenciasComerciais({
      nomeLoja: "Loja Teste", cidade: null, confiancaIdentidade: "ALTA", evidencia: evidence, situacaoCadastral: "ATIVA",
    });
    const inactive = avaliarEvidenciasComerciais({
      nomeLoja: "Loja Teste", cidade: null, confiancaIdentidade: "ALTA", evidencia: evidence, situacaoCadastral: "BAIXADA",
    });
    expect(inactive.scoreEvidencia).toBe(active.scoreEvidencia);
    expect(inactive.pendencias).toContain("revisar situação cadastral: BAIXADA");
  });

  for (const categoria of ["lingerie", "bijuterias", "loja de móveis", "restaurante"]) {
    it("descarta atividade incompatível: " + categoria, () => {
      const result = avaliarEvidenciasComerciais({
        nomeLoja: "Loja Teste", cidade: null, confiancaIdentidade: "ALTA",
        evidencia: { ...evidence, sinaisExclusao: [categoria] }, situacaoCadastral: "ATIVA",
      });
      expect(result.situacao).toBe("NAO_ADERENTE");
      expect(result.scoreEvidencia).toBe(0);
      expect(result.motivosDesqualificacao.join(" ")).toContain(categoria);
    });
  }

  it("descarta loja de marca própria sem prova de revenda multimarcas", () => {
    const result = avaliarEvidenciasComerciais({
      nomeLoja: "Marca Própria", cidade: null, confiancaIdentidade: "ALTA",
      evidencia: { ...evidence, sinaisMultimarcas: [], sinaisMarcaPropria: ["marca própria"], marcas: [] },
      situacaoCadastral: "ATIVA",
    });
    expect(result.situacao).toBe("NAO_ADERENTE");
    expect(result.motivosDesqualificacao.join(" ")).toContain("marca");
  });

  it("descarta loja exclusivamente feminina sem evidência masculina", () => {
    const result = avaliarEvidenciasComerciais({
      nomeLoja: "Loja Feminina", cidade: null, confiancaIdentidade: "ALTA",
      evidencia: { ...evidence, sinaisModaMasculina: [], sinaisModaFeminina: ["moda feminina"] },
      situacaoCadastral: "ATIVA",
    });
    expect(result.situacao).toBe("NAO_ADERENTE");
  });

  it("não atribui aderência sem conteúdo de site", () => {
    const result = avaliarEvidenciasComerciais({
      nomeLoja: "Loja Teste", cidade: null, confiancaIdentidade: "BAIXA", evidencia: null, situacaoCadastral: null,
    });
    expect(result.situacao).toBe("SITE_NAO_VALIDADO");
    expect(result.scoreEvidencia).toBe(0);
  });
});
