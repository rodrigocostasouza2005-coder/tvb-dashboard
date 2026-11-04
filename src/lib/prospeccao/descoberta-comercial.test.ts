import { describe, expect, it } from "vitest";
import { avaliarCandidatoDescoberto, gerarConsultasDescoberta, gerarCsvDescoberta } from "./descoberta-comercial";
import type { PerfilAprendido } from "./aprendizado-comercial";

const perfil: PerfilAprendido = {
  chave: "x", perfil: "MODA MASCULINA · MULTIMARCAS · MEDIO · RJ",
  totalLojas: 8, interacoesComSinal: 6, sinaisPositivos: 5, sinaisNegativos: 1,
  emNegociacao: 2, convertidasDapic: 1, taxaSinalPositivo: 83, taxaConversaoDapic: 13,
  confianca: "BAIXA",
  atributos: { segmentoComercial: "MODA MASCULINA", perfilLoja: "MULTIMARCAS", faixaPreco: "MEDIO", estado: "RJ" },
};
const resultado = { url: "https://exemplo.com.br", titulo: "Loja Exemplo - Moda masculina", trecho: "Multimarcas no Rio" };
const evidencia = {
  url: "https://exemplo.com.br/", titulo: "Loja Exemplo", descricao: "Moda masculina multimarcas",
  texto: "Reserva Aramis Osklen",
  marcas: ["Reserva", "Aramis", "Osklen"], sinaisModaMasculina: ["moda masculina"],
  sinaisMultimarcas: ["multimarcas"],
};

describe("descoberta comercial", () => {
  it("gera buscas com atributos aprendidos e UF, sem duplicar consultas", () => {
    const queries = gerarConsultasDescoberta([perfil], "rj", 8);
    expect(queries[0]).toContain("RJ");
    expect(queries[0]).toContain('"medio"');
    expect(queries[0]).not.toContain("evidencia");
    expect(queries[0]).not.toContain("publica");
    expect(new Set(queries).size).toBe(queries.length);
  });
  it("restringe consultas à cidade escolhida sem perder a UF", () => {
    const queries = gerarConsultasDescoberta([perfil], "RJ", 8, "Niterói");
    expect(queries[0]).toContain("Niterói");
    expect(queries[0]).toContain("RJ");
  });
  it("rejeita site sem evidência de moda masculina", () => {
    expect(avaliarCandidatoDescoberto(resultado, { ...evidencia, sinaisModaMasculina: [] }, perfil.perfil)).toBeNull();
  });
  it("exige sinal multimarcas ou ao menos duas marcas", () => {
    expect(avaliarCandidatoDescoberto(resultado, { ...evidencia, sinaisMultimarcas: [], marcas: ["Reserva"] }, perfil.perfil)).toBeNull();
  });
  it("classifica achado como candidato para revisão, nunca como lead aprovado", () => {
    const candidate = avaliarCandidatoDescoberto(resultado, evidencia, perfil.perfil);
    expect(candidate?.classificacao).toBe("CANDIDATO_PARA_REVISAO");
    expect(candidate?.pontuacaoEvidencia).toBeGreaterThanOrEqual(60);
  });
  it("escapa aspas e listas no CSV", () => {
    const candidate = avaliarCandidatoDescoberto(resultado, evidencia, perfil.perfil)!;
    const csv = gerarCsvDescoberta([candidate]);
    expect(csv).toContain('"Loja Exemplo - Moda masculina"');
    expect(csv).toContain('"Reserva; Aramis; Osklen"');
  });
});
