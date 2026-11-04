import { describe, expect, it } from "vitest";
import { avaliarCandidatoDescoberto, gerarConsultasDescoberta, gerarCsvDescoberta } from "./descoberta-comercial";
import type { PerfilAprendido } from "./aprendizado-comercial";

const perfil: PerfilAprendido = {
  chave: "x", perfil: "SURFWEAR · MODA MASCULINA · MULTIMARCAS · MEDIO · RJ",
  totalLojas: 8, interacoesComSinal: 6, sinaisPositivos: 5, sinaisNegativos: 1,
  emNegociacao: 2, convertidasDapic: 1, taxaSinalPositivo: 83, taxaConversaoDapic: 13,
  confianca: "BAIXA",
  atributos: { segmentoComercial: "SURFWEAR", perfilLoja: "MULTIMARCAS", faixaPreco: "MEDIO", estado: "RJ" },
};
const resultado = { url: "https://exemplo.com.br", titulo: "Surf Shop Exemplo - Moda masculina", trecho: "Multimarcas no Rio" };
const evidencia = {
  url: "https://exemplo.com.br/", titulo: "Surf Shop Exemplo", descricao: "Moda masculina multimarcas surfwear",
  texto: "Reserva Aramis Osklen",
  marcas: ["Reserva", "Aramis", "Osklen"], sinaisModaMasculina: ["moda masculina"],
  sinaisMultimarcas: ["loja multimarcas"], sinaisSurfSkate: ["surfwear"],
};

describe("descoberta comercial surfwear", () => {
  it("gera buscas focadas em surfwear, revenda e município", () => {
    const queries = gerarConsultasDescoberta([perfil], "RJ", 8, "Niterói");
    expect(queries[0]).toContain("surfwear");
    expect(queries[0]).toContain("revenda");
    expect(queries[0]).toContain('"Niterói" RJ');
    expect(new Set(queries).size).toBe(queries.length);
  });
  it("rejeita loja cujo nome não indica surf ou skate", () => {
    expect(avaliarCandidatoDescoberto({ ...resultado, titulo: "Loja Exemplo - Moda masculina" }, evidencia, perfil.perfil)).toBeNull();
  });
  it("rejeita site sem evidência de moda masculina", () => {
    expect(avaliarCandidatoDescoberto(resultado, { ...evidencia, sinaisModaMasculina: [] }, perfil.perfil)).toBeNull();
  });
  it("exige sinal explícito de revenda multimarcas e duas marcas", () => {
    expect(avaliarCandidatoDescoberto(resultado, { ...evidencia, sinaisMultimarcas: [], marcas: ["Reserva"] }, perfil.perfil)).toBeNull();
    expect(avaliarCandidatoDescoberto(resultado, { ...evidencia, sinaisMultimarcas: [] }, perfil.perfil)).toBeNull();
  });
  it("rejeita categorias incompatíveis", () => {
    expect(avaliarCandidatoDescoberto(resultado, { ...evidencia, sinaisExclusao: ["lingerie"] }, perfil.perfil)).toBeNull();
    expect(avaliarCandidatoDescoberto(resultado, { ...evidencia, sinaisExclusao: ["restaurante"] }, perfil.perfil)).toBeNull();
  });
  it("rejeita qualquer fabricante ou marca própria, mesmo se declarar multimarcas", () => {
    expect(avaliarCandidatoDescoberto(resultado, { ...evidencia, sinaisMarcaPropria: ["marca própria"] }, perfil.perfil)).toBeNull();
  });
  it("não aceita loja feminina sem sinal de linha masculina", () => {
    expect(avaliarCandidatoDescoberto(resultado, { ...evidencia, sinaisModaMasculina: [], sinaisModaFeminina: ["moda feminina"] }, perfil.perfil)).toBeNull();
  });
  it("classifica achado como candidato para revisão, nunca lead aprovado", () => {
    const candidate = avaliarCandidatoDescoberto(resultado, evidencia, perfil.perfil);
    expect(candidate?.classificacao).toBe("CANDIDATO_PARA_REVISAO");
    expect(candidate?.pontuacaoEvidencia).toBeGreaterThanOrEqual(60);
  });
  it("escapa aspas e listas no CSV", () => {
    const candidate = avaliarCandidatoDescoberto(resultado, evidencia, perfil.perfil)!;
    const csv = gerarCsvDescoberta([candidate]);
    expect(csv).toContain('"Surf Shop Exemplo - Moda masculina"');
    expect(csv).toContain('"Reserva; Aramis; Osklen"');
  });
});
