import { describe, expect, it } from "vitest";
import { qualificarProspect } from "./motor-qualificacao";
import type { EvidenciaSite } from "./pesquisa-web";
import {
  calcularCnpjRaiz,
  construirOperacoesMarcas,
  montarCandidatoPesquisaComercial,
  montarRegistroQualificacao,
  prepararCandidatosParaQuota,
} from "./adaptadores-qualificacao";

const CNPJ_VALIDO = "11222333000181";
const AGORA = new Date("2026-11-01T12:00:00Z");

function siteVazio(overrides: Partial<EvidenciaSite> = {}): EvidenciaSite {
  return {
    url: "https://lojateste.com.br",
    titulo: "Loja Teste",
    descricao: "",
    texto: "",
    marcas: [],
    sinaisModaMasculina: [],
    sinaisMultimarcas: [],
    sinaisExclusao: [],
    sinaisMarcaPropria: [],
    sinaisModaFeminina: [],
    sinaisSurfSkate: [],
    ...overrides,
  };
}

describe("calcularCnpjRaiz", () => {
  it("retorna os 8 primeiros dígitos do CNPJ", () => {
    expect(calcularCnpjRaiz(CNPJ_VALIDO)).toBe("11222333");
  });
  it("retorna null para CNPJ ausente ou curto demais", () => {
    expect(calcularCnpjRaiz(null)).toBeNull();
    expect(calcularCnpjRaiz("123")).toBeNull();
  });
});

describe("montarCandidatoPesquisaComercial", () => {
  const base = {
    nomeFantasia: "Surf Shop Teste", cnpj: CNPJ_VALIDO, cnpjValido: true, hasContato: true,
    situacaoCadastral: "ATIVA" as const, dataVerificacao: AGORA,
    fontesOficiaisConsultadas: true, instagramEncontrado: false,
    potencialComercialSinais: [],
  };

  it("marca citada SEM sinal explícito de multimarcas não entra em `marcas` (conservador)", () => {
    const candidato = montarCandidatoPesquisaComercial({
      ...base, confianca: "ALTA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
      evidencia: siteVazio({ marcas: ["Reserva", "Osklen"], sinaisModaMasculina: ["masculino"], sinaisMultimarcas: [] }),
    });
    expect(candidato.marcas).toEqual([]);
  });

  it("marca citada COM sinal explícito de multimarcas e site confiável entra em `marcas`", () => {
    const candidato = montarCandidatoPesquisaComercial({
      ...base, confianca: "ALTA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
      evidencia: siteVazio({
        marcas: ["Reserva", "Osklen"],
        sinaisModaMasculina: ["masculino"],
        sinaisMultimarcas: ["loja multimarcas"],
        sinaisSurfSkate: ["surf shop"],
      }),
    });
    expect(candidato.marcas).toHaveLength(2);
    expect(candidato.marcas.map((m) => m.marca).sort()).toEqual(["Osklen", "Reserva"]);
    expect(candidato.marcas[0].confianca).toBe("ALTA");
    expect(candidato.evidenciaModaMasculina).toHaveLength(1);
    expect(candidato.evidenciaPosicionamentoTvb).toHaveLength(1);
  });

  it("confiança BAIXA nunca produz evidência de atividade/varejo, mesmo com sinais no texto", () => {
    const candidato = montarCandidatoPesquisaComercial({
      ...base, confianca: "BAIXA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
      evidencia: siteVazio({ marcas: ["Reserva", "Osklen"], sinaisMultimarcas: ["loja multimarcas"] }),
    });
    expect(candidato.evidenciaAtividadeComercial).toEqual([]);
    expect(candidato.evidenciaVarejoVestuario).toEqual([]);
    expect(candidato.marcas).toEqual([]);
  });

  it("CNPJ inválido bloqueia por CADASTRO_INATIVO_OU_INVALIDO mesmo com evidência comercial forte", () => {
    const candidato = montarCandidatoPesquisaComercial({
      ...base, cnpjValido: false, confianca: "ALTA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
      evidencia: siteVazio({ marcas: ["Reserva", "Osklen"], sinaisModaMasculina: ["masculino"], sinaisMultimarcas: ["loja multimarcas"] }),
    });
    expect(candidato.categoriasBloqueio).toContain("CADASTRO_INATIVO_OU_INVALIDO");
    expect(qualificarProspect(candidato).eliminacao.resultado).toBe("REPROVADO");
  });

  it("situação cadastral BAIXADA bloqueia mesmo com CNPJ válido", () => {
    const candidato = montarCandidatoPesquisaComercial({
      ...base, situacaoCadastral: "BAIXADA", confianca: "ALTA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
      evidencia: siteVazio(),
    });
    expect(candidato.categoriasBloqueio).toContain("CADASTRO_INATIVO_OU_INVALIDO");
  });

  it("sinal de exclusão 'lingerie' mapeia para categoria LINGERIE tipada", () => {
    const candidato = montarCandidatoPesquisaComercial({
      ...base, confianca: "ALTA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
      evidencia: siteVazio({ sinaisExclusao: ["lingerie"] }),
    });
    expect(candidato.categoriasBloqueio).toContain("LINGERIE");
  });

  it("sinal de exclusão de alimentação mapeia para categoria ALIMENTACAO", () => {
    const candidato = montarCandidatoPesquisaComercial({
      ...base, confianca: "ALTA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
      evidencia: siteVazio({ sinaisExclusao: ["restaurante"] }),
    });
    expect(candidato.categoriasBloqueio).toContain("ALIMENTACAO");
  });

  // Regressão trazida de avaliacao-comercial.test.ts (removido na faxina pós-auditoria, PR #51+):
  // aquele teste cobria "bijuterias"/"loja de móveis" como texto de exclusão ponta a ponta. Esta
  // camada (EXCLUSAO_PARA_CATEGORIA) já tinha os termos mapeados, mas não tinha teste próprio —
  // adicionado aqui para não perder cobertura líquida do critério ao remover o arquivo antigo.
  it("sinal de exclusão 'bijuterias' mapeia para categoria JOALHERIA_BIJUTERIA tipada", () => {
    const candidato = montarCandidatoPesquisaComercial({
      ...base, confianca: "ALTA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
      evidencia: siteVazio({ sinaisExclusao: ["bijuterias"] }),
    });
    expect(candidato.categoriasBloqueio).toContain("JOALHERIA_BIJUTERIA");
  });

  it("sinal de exclusão 'loja de móveis' mapeia para categoria MOVEIS tipada", () => {
    const candidato = montarCandidatoPesquisaComercial({
      ...base, confianca: "ALTA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
      evidencia: siteVazio({ sinaisExclusao: ["loja de móveis"] }),
    });
    expect(candidato.categoriasBloqueio).toContain("MOVEIS");
  });

  it("marca própria bloqueia por SOMENTE_MARCA_PROPRIA", () => {
    const candidato = montarCandidatoPesquisaComercial({
      ...base, confianca: "ALTA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
      evidencia: siteVazio({ sinaisMarcaPropria: ["marca própria"] }),
    });
    expect(candidato.categoriasBloqueio).toContain("SOMENTE_MARCA_PROPRIA");
  });

  it("sinal feminino sem sinal masculino bloqueia por SOMENTE_FEMININO; com masculino, não bloqueia", () => {
    const soFeminino = montarCandidatoPesquisaComercial({
      ...base, confianca: "ALTA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
      evidencia: siteVazio({ sinaisModaFeminina: ["moda feminina"] }),
    });
    expect(soFeminino.categoriasBloqueio).toContain("SOMENTE_FEMININO");

    const ambos = montarCandidatoPesquisaComercial({
      ...base, confianca: "ALTA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
      evidencia: siteVazio({ sinaisModaFeminina: ["moda feminina"], sinaisModaMasculina: ["masculino"] }),
    });
    expect(ambos.categoriasBloqueio).not.toContain("SOMENTE_FEMININO");
  });

  it("ponta a ponta: evidência forte o bastante leva o motor a PENDENTE_REVISAO_HUMANA (nunca APROVADO)", () => {
    const candidato = montarCandidatoPesquisaComercial({
      ...base, confianca: "ALTA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
      instagramEncontrado: true,
      evidencia: siteVazio({
        marcas: ["Reserva", "Osklen", "Ellus"],
        sinaisModaMasculina: ["moda masculina", "roupa masculina"],
        sinaisMultimarcas: ["loja multimarcas", "revenda de marcas"],
        sinaisSurfSkate: ["surf shop"],
      }),
    });
    const resultado = qualificarProspect(candidato);
    expect(resultado.eliminacao.resultado).toBe("APROVADO_GATE");
    expect(resultado.statusComercial).toBe("PENDENTE_REVISAO_HUMANA");
    expect(resultado.statusComercial).not.toBe("APROVADO");
  });
});

describe("montarRegistroQualificacao", () => {
  const baseComercial = {
    nomeFantasia: "Loja X", cnpj: CNPJ_VALIDO, cnpjValido: true, hasContato: true,
    situacaoCadastral: "ATIVA" as const, dataVerificacao: AGORA, fontesOficiaisConsultadas: true,
    instagramEncontrado: false, potencialComercialSinais: [],
  };

  it("gate reprovado (ex.: marca própria) nunca grava status que pareça aprovação", () => {
    const resultado = qualificarProspect(
      montarCandidatoPesquisaComercial({
        ...baseComercial, confianca: "ALTA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
        evidencia: siteVazio({ sinaisMarcaPropria: ["marca própria"] }),
      }),
    );
    const registro = montarRegistroQualificacao(resultado);
    expect(registro.status).toBe("DESCARTADO");
    expect(registro.statusComercial).toBe("REPROVADO");
    expect(registro.classificacaoProspect).toBeNull();
    expect(registro.scoreComercial).toBeNull();
  });

  it("INCONCLUSIVO (multimarcas e moda masculina OK, mas posicionamento TVB ainda sem evidência) grava EM_QUALIFICACAO, não DESCARTADO", () => {
    // Nota: só é possível chegar em INCONCLUSIVO quando multimarcas já está ATENDE (>=2 marcas
    // comprovadas) — esse critério específico não tem estado intermediário (ver comentário em
    // motor-elegibilidade.ts e no topo deste arquivo). Zero marca sempre reprova, nunca fica pendente.
    const resultado = qualificarProspect(
      montarCandidatoPesquisaComercial({
        ...baseComercial, confianca: "ALTA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
        evidencia: siteVazio({
          marcas: ["Reserva", "Osklen"],
          sinaisModaMasculina: ["moda masculina"],
          sinaisMultimarcas: ["loja multimarcas"],
          // sem sinaisSurfSkate: posicionamento TVB fica sem evidência -> INCONCLUSIVO geral.
        }),
      }),
    );
    expect(resultado.eliminacao.resultado).toBe("INCONCLUSIVO");
    const registro = montarRegistroQualificacao(resultado);
    expect(registro.status).toBe("EM_QUALIFICACAO");
    expect(registro.statusComercial).toBe("EM_INVESTIGACAO");
  });

  it("PENDENTE_REVISAO_HUMANA preserva scoreDetalhe e evidências estruturadas pra auditoria", () => {
    const candidato = montarCandidatoPesquisaComercial({
      nomeFantasia: "Surf Shop Teste", cnpj: CNPJ_VALIDO, cnpjValido: true, hasContato: true,
      situacaoCadastral: "ATIVA", dataVerificacao: AGORA, fontesOficiaisConsultadas: true,
      instagramEncontrado: true, potencialComercialSinais: [{ descricao: "porte grande" }],
      confianca: "ALTA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
      evidencia: siteVazio({
        marcas: ["Reserva", "Osklen", "Ellus"],
        sinaisModaMasculina: ["moda masculina"],
        sinaisMultimarcas: ["loja multimarcas"],
        sinaisSurfSkate: ["surf shop"],
      }),
    });
    const resultado = qualificarProspect(candidato);
    const registro = montarRegistroQualificacao(resultado);
    expect(registro.status).toBe("EM_QUALIFICACAO");
    expect(registro.scoreDetalhe).not.toBeNull();
    expect(registro.evidenciasQualificacao.criterios).toBeDefined();
  });
});

describe("construirOperacoesMarcas", () => {
  it("deduplica marca repetida (variação de acento/maiúscula) em uma única operação", () => {
    const candidato = montarCandidatoPesquisaComercial({
      nomeFantasia: "Loja", cnpj: CNPJ_VALIDO, cnpjValido: true, hasContato: true,
      situacaoCadastral: "ATIVA", dataVerificacao: AGORA, fontesOficiaisConsultadas: true,
      instagramEncontrado: false, potencialComercialSinais: [],
      confianca: "ALTA", siteConfirmado: "https://loja.com.br", urlReferencia: "https://loja.com.br",
      evidencia: siteVazio({ marcas: ["Nike", "Nike"], sinaisMultimarcas: ["loja multimarcas"] }),
    });
    const operacoes = construirOperacoesMarcas(candidato.marcas);
    expect(operacoes).toHaveLength(1);
    expect(operacoes[0].marcaNormalizada).toBe("nike");
  });

  it("marca sem evidência completa (ex: sem fonteUrl) não gera operação", () => {
    const operacoes = construirOperacoesMarcas([
      { marca: "Reserva", evidencia: "", fonteUrl: "", dataVerificacao: AGORA, tipoEvidencia: "SITE_OFICIAL", confianca: "ALTA" },
    ]);
    expect(operacoes).toEqual([]);
  });
});

describe("prepararCandidatosParaQuota", () => {
  it("ignora prospect sem score (gate não aprovou) e sem estado", () => {
    const candidatos = prepararCandidatosParaQuota([
      { id: "a", estado: "RJ", cidade: "Niterói", scoreComercial: 80 },
      { id: "b", estado: "RJ", cidade: "Niterói", scoreComercial: null },
      { id: "c", estado: null, cidade: "Niterói", scoreComercial: 90 },
    ]);
    expect(candidatos).toEqual([{ id: "a", uf: "RJ", municipio: "Niterói", score: 80 }]);
  });
});
