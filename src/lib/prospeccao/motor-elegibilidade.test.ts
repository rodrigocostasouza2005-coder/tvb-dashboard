import { describe, expect, it } from "vitest";
import { avaliarEliminacao, avaliarMultimarcas, type CandidatoProspect, type EvidenciaMarca } from "./motor-elegibilidade";

const CNPJ_VALIDO = "11222333000181"; // mesmo usado em outros testes do módulo cnpj.ts

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

function evidencia(descricao: string): { descricao: string; fonteUrl: string | null; dataVerificacao: Date } {
  return { descricao, fonteUrl: "https://lojateste.com.br", dataVerificacao: new Date("2026-11-01") };
}

/** Candidato que atende perfeitamente todos os 6 critérios obrigatórios. */
function candidatoCompleto(overrides: Partial<CandidatoProspect> = {}): CandidatoProspect {
  return {
    nomeFantasia: "Loja Teste Surf Shop",
    cnpj: CNPJ_VALIDO,
    situacaoCadastral: "ATIVA",
    categoriasBloqueio: [],
    evidenciaExistencia: [evidencia("CNPJ confirmado na Receita Federal/Serpro")],
    evidenciaAtividadeComercial: [evidencia("Posts recentes de venda no Instagram comercial")],
    evidenciaVarejoVestuario: [evidencia("Loja física vendendo roupas, catálogo online ativo")],
    evidenciaModaMasculina: [evidencia("Linha masculina completa no catálogo: camisas, bermudas, boardshorts")],
    marcas: [marca("Reserva"), marca("Osklen")],
    evidenciaPosicionamentoTvb: [evidencia("Loja de surfwear/streetwear masculino, perfil compatível com TVB")],
    ...overrides,
  };
}

describe("avaliarMultimarcas", () => {
  it("exige ao menos 2 marcas distintas e completas", () => {
    expect(avaliarMultimarcas([marca("Reserva"), marca("Osklen")]).comprovado).toBe(true);
    expect(avaliarMultimarcas([marca("Reserva")]).comprovado).toBe(false);
    expect(avaliarMultimarcas([]).comprovado).toBe(false);
  });

  it("nunca conta duas linhas da MESMA marca como duas marcas distintas", () => {
    const resultado = avaliarMultimarcas([marca("Nike"), marca("nike "), marca("NIKE")]);
    expect(resultado.marcasDistintas).toHaveLength(1);
    expect(resultado.comprovado).toBe(false);
  });

  it("descarta registro de marca incompleto (sem fonte, sem data, sem tipo etc.) da contagem", () => {
    const incompleta = { ...marca("Lacoste"), fonteUrl: "" };
    const resultado = avaliarMultimarcas([marca("Reserva"), incompleta]);
    expect(resultado.marcasDistintas).toEqual(["Reserva"]);
    expect(resultado.comprovado).toBe(false);
  });
});

describe("avaliarEliminacao — gate obrigatório", () => {
  it("aprova no gate (APROVADO_GATE) quando todos os 6 critérios são atendidos", () => {
    const resultado = avaliarEliminacao(candidatoCompleto());
    expect(resultado.resultado).toBe("APROVADO_GATE");
    expect(resultado.motivosReprovacao).toEqual([]);
    expect(resultado.criterios.every((c) => c.resultado === "ATENDE")).toBe(true);
  });

  it("reprova (REPROVADO) quando faltam marcas de terceiros comprovadas, mesmo com tudo mais perfeito", () => {
    const resultado = avaliarEliminacao(candidatoCompleto({ marcas: [] }));
    expect(resultado.resultado).toBe("REPROVADO");
    const multimarcas = resultado.criterios.find((c) => c.id === "MULTIMARCAS");
    expect(multimarcas?.resultado).toBe("NAO_ATENDE");
  });

  it("reprova com apenas 1 marca comprovada (mínimo exigido é 2)", () => {
    const resultado = avaliarEliminacao(candidatoCompleto({ marcas: [marca("Reserva")] }));
    expect(resultado.resultado).toBe("REPROVADO");
  });

  for (const categoria of [
    "LINGERIE",
    "JOALHERIA_BIJUTERIA",
    "MOVEIS",
    "ALIMENTACAO",
    "BRECHO_USADOS",
    "ALFAIATE_SEM_MULTIMARCAS",
    "FABRICANTE_SEM_REVENDA",
  ] as const) {
    it(`bloqueio automático reprova sempre: ${categoria}`, () => {
      const resultado = avaliarEliminacao(candidatoCompleto({ categoriasBloqueio: [categoria] }));
      expect(resultado.resultado).toBe("REPROVADO");
    });
  }

  it("bloqueio SOMENTE_MARCA_PROPRIA reprova mesmo com 2+ marcas de terceiros citadas (dado suspeito, prevalece o bloqueio)", () => {
    const resultado = avaliarEliminacao(candidatoCompleto({ categoriasBloqueio: ["SOMENTE_MARCA_PROPRIA"] }));
    expect(resultado.resultado).toBe("REPROVADO");
    const multimarcas = resultado.criterios.find((c) => c.id === "MULTIMARCAS");
    expect(multimarcas?.resultado).toBe("NAO_ATENDE");
  });

  it("bloqueio SOMENTE_FEMININO e SOMENTE_INFANTIL reprovam a loja", () => {
    expect(avaliarEliminacao(candidatoCompleto({ categoriasBloqueio: ["SOMENTE_FEMININO"] })).resultado).toBe("REPROVADO");
    expect(avaliarEliminacao(candidatoCompleto({ categoriasBloqueio: ["SOMENTE_INFANTIL"] })).resultado).toBe("REPROVADO");
  });

  it("cadastro inativo/inválido reprova mesmo com CNPJ formalmente válido", () => {
    const resultado = avaliarEliminacao(candidatoCompleto({ categoriasBloqueio: ["CADASTRO_INATIVO_OU_INVALIDO"] }));
    expect(resultado.resultado).toBe("REPROVADO");
  });

  it("CNAE não é usado em nenhum critério — o tipo CandidatoProspect nem aceita esse campo (só evidência observada)", () => {
    // Teste de documentação: garante que o gate não tem como "ler CNAE" mesmo que alguém tente
    // passar via objeto solto — TypeScript já bloqueia isso em tempo de compilação.
    const resultado = avaliarEliminacao(candidatoCompleto());
    expect(resultado.criterios.find((c) => c.id === "MULTIMARCAS")?.motivo).not.toContain("CNAE");
  });

  it("é INCONCLUSIVO (não aprovado nem reprovado) quando falta evidência mas nada foi bloqueado", () => {
    const resultado = avaliarEliminacao(candidatoCompleto({ evidenciaPosicionamentoTvb: [] }));
    expect(resultado.resultado).toBe("INCONCLUSIVO");
    const posicionamento = resultado.criterios.find((c) => c.id === "POSICIONAMENTO_TVB");
    expect(posicionamento?.resultado).toBe("INCONCLUSIVO");
  });

  it("uma falha definitiva (NAO_ATENDE) vence qualquer INCONCLUSIVO — resultado final é REPROVADO, não INCONCLUSIVO", () => {
    const resultado = avaliarEliminacao(
      candidatoCompleto({ marcas: [], evidenciaPosicionamentoTvb: [] }),
    );
    expect(resultado.resultado).toBe("REPROVADO");
  });

  it("existência fica INCONCLUSIVA sem CNPJ válido ou situação cadastral confirmada", () => {
    const resultado = avaliarEliminacao(candidatoCompleto({ cnpj: null, situacaoCadastral: null, evidenciaExistencia: [] }));
    expect(resultado.resultado).toBe("INCONCLUSIVO");
    expect(resultado.criterios.find((c) => c.id === "EXISTENCIA")?.resultado).toBe("INCONCLUSIVO");
  });
});
