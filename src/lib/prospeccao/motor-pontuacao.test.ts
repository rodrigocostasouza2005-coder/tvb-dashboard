import { describe, expect, it } from "vitest";
import type { EvidenciaMarca } from "./motor-elegibilidade";
import { PONTO_CORTE_APROVACAO, PONTO_CORTE_ALTA_PRIORIDADE, pontuarProspect } from "./motor-pontuacao";

function marca(nome: string, confianca: EvidenciaMarca["confianca"] = "ALTA"): EvidenciaMarca {
  return {
    marca: nome,
    evidencia: `Evidência de ${nome}`,
    fonteUrl: "https://lojateste.com.br",
    dataVerificacao: new Date("2026-11-01"),
    tipoEvidencia: "SITE_OFICIAL",
    confianca,
  };
}

function entradaMaxima() {
  return {
    marcas: [marca("Reserva"), marca("Osklen"), marca("Ellus"), marca("Colcci")],
    evidenciaModaMasculina: [{ descricao: "a", fonteUrl: null, dataVerificacao: new Date() }, { descricao: "b", fonteUrl: null, dataVerificacao: new Date() }, { descricao: "c", fonteUrl: null, dataVerificacao: new Date() }],
    evidenciaAtividadeComercial: [{ descricao: "a", fonteUrl: null, dataVerificacao: new Date() }],
    evidenciaVarejoVestuario: [{ descricao: "a", fonteUrl: null, dataVerificacao: new Date() }],
    evidenciaPosicionamentoTvb: [{ descricao: "a", fonteUrl: null, dataVerificacao: new Date() }],
    fontesOficiaisConsultadas: true,
    fontesMultiplas: true,
    informacaoAtualizada: true,
    potencialComercialSinais: [{ descricao: "porte grande" }, { descricao: "localização estratégica" }],
  };
}

describe("pontuarProspect", () => {
  it("soma os 5 sub-scores até no máximo 100", () => {
    const resultado = pontuarProspect(entradaMaxima());
    expect(resultado.total).toBeLessThanOrEqual(100);
    expect(resultado.subScores).toHaveLength(5);
    expect(resultado.subScores.reduce((s, x) => s + x.maximo, 0)).toBe(100);
  });

  it("classifica ALTA_PRIORIDADE quando total >= 85", () => {
    const resultado = pontuarProspect(entradaMaxima());
    expect(resultado.total).toBeGreaterThanOrEqual(PONTO_CORTE_ALTA_PRIORIDADE);
    expect(resultado.classificacao).toBe("ALTA_PRIORIDADE");
  });

  it("classifica QUALIFICADO entre 75 e 84", () => {
    const resultado = pontuarProspect({
      ...entradaMaxima(),
      marcas: [marca("Reserva"), marca("Osklen")], // mínimo: tira o bônus de quantidade
      evidenciaModaMasculina: [
        { descricao: "a", fonteUrl: null, dataVerificacao: new Date() },
        { descricao: "b", fonteUrl: null, dataVerificacao: new Date() },
      ],
      potencialComercialSinais: [],
    });
    expect(resultado.total).toBeGreaterThanOrEqual(PONTO_CORTE_APROVACAO);
    expect(resultado.total).toBeLessThan(PONTO_CORTE_ALTA_PRIORIDADE);
    expect(resultado.classificacao).toBe("QUALIFICADO");
  });

  it("classifica REPROVADO quando total < 75, mesmo com 2 marcas mínimas presentes", () => {
    const resultado = pontuarProspect({
      marcas: [marca("Reserva"), marca("Osklen")],
      evidenciaModaMasculina: [],
      evidenciaAtividadeComercial: [],
      evidenciaVarejoVestuario: [],
      evidenciaPosicionamentoTvb: [],
      fontesOficiaisConsultadas: false,
      fontesMultiplas: false,
      informacaoAtualizada: false,
      potencialComercialSinais: [],
    });
    expect(resultado.total).toBeLessThan(PONTO_CORTE_APROVACAO);
    expect(resultado.classificacao).toBe("REPROVADO");
  });

  it("cada sub-score vem com rationale explicável, nunca só o número", () => {
    const resultado = pontuarProspect(entradaMaxima());
    for (const sub of resultado.subScores) {
      expect(sub.rationale.length).toBeGreaterThan(0);
      expect(sub.pontos).toBeLessThanOrEqual(sub.maximo);
    }
  });

  it("marcas com confiança BAIXA pontuam menos no critério de multimarcas que marcas ALTA", () => {
    const comAlta = pontuarProspect({ ...entradaMaxima(), marcas: [marca("Reserva", "ALTA"), marca("Osklen", "ALTA")] });
    const comBaixa = pontuarProspect({ ...entradaMaxima(), marcas: [marca("Reserva", "BAIXA"), marca("Osklen", "BAIXA")] });
    const subAlta = comAlta.subScores.find((s) => s.criterio.includes("multimarcas"))!;
    const subBaixa = comBaixa.subScores.find((s) => s.criterio.includes("multimarcas"))!;
    expect(subAlta.pontos).toBeGreaterThan(subBaixa.pontos);
  });
});
