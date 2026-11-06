import { describe, expect, it } from "vitest";
import type { EvidenciaMarca } from "./motor-elegibilidade";
import {
  detectarPossivelDuplicata,
  qualificarProspect,
  type CandidatoDedup,
  type EntradaQualificacao,
} from "./motor-qualificacao";

const CNPJ_VALIDO = "11222333000181";

function marca(nome: string, overrides: Partial<EvidenciaMarca> = {}): EvidenciaMarca {
  return {
    marca: nome,
    evidencia: `Produto da marca ${nome} encontrado no catálogo oficial.`,
    fonteUrl: "https://lojateste.com.br/catalogo",
    dataVerificacao: new Date("2026-11-01"),
    tipoEvidencia: "SITE_OFICIAL",
    confianca: "ALTA",
    ...overrides,
  };
}

function ev(descricao: string) {
  return { descricao, fonteUrl: "https://lojateste.com.br", dataVerificacao: new Date("2026-11-01") };
}

/**
 * Candidato "perfeito em tudo, exceto marcas" — usado pelo teste mais importante deste arquivo:
 * mesmo com evidência de existência, atividade, varejo, moda masculina e posicionamento TVB
 * todas maximizadas (o que daria sub-scores altíssimos nos OUTROS 4 critérios de pontuação),
 * zero evidência de marca de terceiro tem que bastar, sozinha, pra reprovar — sem meio-termo.
 */
function candidatoPerfeitoExcetoMarcas(marcas: EvidenciaMarca[]): EntradaQualificacao {
  return {
    nomeFantasia: "Loja Perfeita Surf Shop",
    cnpj: CNPJ_VALIDO,
    situacaoCadastral: "ATIVA",
    categoriasBloqueio: [],
    evidenciaExistencia: [ev("CNPJ confirmado na Receita Federal/Serpro")],
    evidenciaAtividadeComercial: [ev("Posts recentes de venda"), ev("Avaliações de clientes recentes"), ev("Google Meu Negócio ativo")],
    evidenciaVarejoVestuario: [ev("Loja física"), ev("Catálogo online ativo")],
    evidenciaModaMasculina: [ev("Linha masculina completa"), ev("Camisaria"), ev("Bermudas e boardshorts")],
    marcas,
    evidenciaPosicionamentoTvb: [ev("Perfil surfwear/streetwear masculino, altamente compatível com TVB")],
    fontesOficiaisConsultadas: true,
    fontesMultiplas: true,
    informacaoAtualizada: true,
    potencialComercialSinais: [{ descricao: "porte grande" }, { descricao: "localização estratégica" }, { descricao: "volume indicado alto" }],
  };
}

describe("qualificarProspect — regra central: nenhum score salva quem falha o gate", () => {
  it("TESTE CRÍTICO: zero evidência de marca de terceiro NUNCA é aprovado, mesmo com todos os outros critérios perfeitos", () => {
    const resultado = qualificarProspect(candidatoPerfeitoExcetoMarcas([]));

    expect(resultado.eliminacao.resultado).toBe("REPROVADO");
    expect(resultado.statusComercial).toBe("REPROVADO");
    // A garantia mais importante: a pontuação NUNCA é calculada pra quem falha o gate — não é
    // "pontuação baixa", é ausência total de pontuação, impossível de contornar depois.
    expect(resultado.pontuacao).toBeNull();
    expect(resultado.eliminacao.motivosReprovacao.join(" ")).toMatch(/marca/i);
  });

  it("TESTE CRÍTICO (variação): 1 marca de terceiro comprovada também nunca basta, mesmo perfeito em tudo mais", () => {
    const resultado = qualificarProspect(candidatoPerfeitoExcetoMarcas([marca("Reserva")]));
    expect(resultado.eliminacao.resultado).toBe("REPROVADO");
    expect(resultado.statusComercial).toBe("REPROVADO");
    expect(resultado.pontuacao).toBeNull();
  });

  it("TESTE CRÍTICO (variação): 'duas' linhas da mesma marca não contam como 2 marcas — continua reprovado", () => {
    const resultado = qualificarProspect(candidatoPerfeitoExcetoMarcas([marca("Nike"), marca("NIKE "), marca("nike")]));
    expect(resultado.eliminacao.resultado).toBe("REPROVADO");
    expect(resultado.statusComercial).toBe("REPROVADO");
    expect(resultado.pontuacao).toBeNull();
  });

  it("com 2 marcas distintas comprovadas, o mesmo candidato passa no gate e É pontuado", () => {
    const resultado = qualificarProspect(candidatoPerfeitoExcetoMarcas([marca("Reserva"), marca("Osklen")]));
    expect(resultado.eliminacao.resultado).toBe("APROVADO_GATE");
    expect(resultado.pontuacao).not.toBeNull();
    expect(resultado.pontuacao!.total).toBeGreaterThanOrEqual(75);
  });
});

describe("qualificarProspect — statusComercial nunca é APROVADO automaticamente", () => {
  it("mesmo um candidato ALTA_PRIORIDADE (score alto) vira PENDENTE_REVISAO_HUMANA, nunca APROVADO direto", () => {
    const resultado = qualificarProspect(
      candidatoPerfeitoExcetoMarcas([marca("Reserva"), marca("Osklen"), marca("Ellus"), marca("Colcci")]),
    );
    expect(resultado.pontuacao?.classificacao).toBe("ALTA_PRIORIDADE");
    expect(resultado.statusComercial).toBe("PENDENTE_REVISAO_HUMANA");
    expect(resultado.statusComercial).not.toBe("APROVADO");
  });

  it("gate inconclusivo (falta evidência, nada bloqueado) vira EM_INVESTIGACAO, não REPROVADO nem aprovado", () => {
    const candidato = candidatoPerfeitoExcetoMarcas([marca("Reserva"), marca("Osklen")]);
    const resultado = qualificarProspect({ ...candidato, evidenciaPosicionamentoTvb: [] });
    expect(resultado.eliminacao.resultado).toBe("INCONCLUSIVO");
    expect(resultado.statusComercial).toBe("EM_INVESTIGACAO");
    expect(resultado.pontuacao).toBeNull();
  });

  it("passou no gate mas pontuação < 75 vira REPROVADO (não fica pendente pra sempre)", () => {
    // 2 marcas mínimas, mas sem nenhuma outra evidência de reforço — pontuação deve cair < 75.
    const resultado = qualificarProspect({
      nomeFantasia: "Loja Fraca",
      cnpj: CNPJ_VALIDO,
      situacaoCadastral: "ATIVA",
      categoriasBloqueio: [],
      evidenciaExistencia: [ev("x")],
      evidenciaAtividadeComercial: [ev("x")],
      evidenciaVarejoVestuario: [ev("x")],
      evidenciaModaMasculina: [ev("x")],
      marcas: [marca("Reserva"), marca("Osklen")],
      evidenciaPosicionamentoTvb: [ev("x")],
      fontesOficiaisConsultadas: false,
      fontesMultiplas: false,
      informacaoAtualizada: false,
      potencialComercialSinais: [],
    });
    expect(resultado.eliminacao.resultado).toBe("APROVADO_GATE");
    expect(resultado.pontuacao).not.toBeNull();
    expect(resultado.pontuacao!.total).toBeLessThan(75);
    expect(resultado.statusComercial).toBe("REPROVADO");
  });
});

describe("detectarPossivelDuplicata", () => {
  const existentes: CandidatoDedup[] = [
    { id: "p1", cnpj: "11222333000181", cnpjRaiz: "11222333", nomeFantasia: "Loja Alfa", cidade: "Rio de Janeiro", estado: "RJ", enderecoOficial: "Rua A, 123" },
  ];

  it("detecta mesmo CNPJ", () => {
    const sinais = detectarPossivelDuplicata(
      { id: "novo", cnpj: "11222333000181", cnpjRaiz: "11222333", nomeFantasia: "Outro Nome", cidade: "Outra Cidade", estado: "SP", enderecoOficial: null },
      existentes,
    );
    expect(sinais.some((s) => s.tipo === "CNPJ")).toBe(true);
  });

  it("detecta nome igual no mesmo município", () => {
    const sinais = detectarPossivelDuplicata(
      { id: "novo", cnpj: null, cnpjRaiz: null, nomeFantasia: "loja alfa", cidade: "Rio de Janeiro", estado: "RJ", enderecoOficial: null },
      existentes,
    );
    expect(sinais.some((s) => s.tipo === "NOME_MESMO_MUNICIPIO")).toBe(true);
  });

  it("detecta mesmo endereço oficial", () => {
    const sinais = detectarPossivelDuplicata(
      { id: "novo", cnpj: null, cnpjRaiz: null, nomeFantasia: "Nome Diferente", cidade: "Outra", estado: "MG", enderecoOficial: "RUA A, 123" },
      existentes,
    );
    expect(sinais.some((s) => s.tipo === "ENDERECO")).toBe(true);
  });

  it("NÃO reporta duplicata só porque é filial do mesmo cnpjRaiz em município diferente", () => {
    const sinais = detectarPossivelDuplicata(
      { id: "filial", cnpj: "11222333000262", cnpjRaiz: "11222333", nomeFantasia: "Loja Alfa", cidade: "Niterói", estado: "RJ", enderecoOficial: "Rua B, 456" },
      existentes,
    );
    expect(sinais).toEqual([]);
  });

  it("nome igual em município DIFERENTE não é reportado como duplicata (pode ser filial legítima)", () => {
    const sinais = detectarPossivelDuplicata(
      { id: "novo", cnpj: null, cnpjRaiz: null, nomeFantasia: "Loja Alfa", cidade: "Niterói", estado: "RJ", enderecoOficial: null },
      existentes,
    );
    expect(sinais.some((s) => s.tipo === "NOME_MESMO_MUNICIPIO")).toBe(false);
  });
});
