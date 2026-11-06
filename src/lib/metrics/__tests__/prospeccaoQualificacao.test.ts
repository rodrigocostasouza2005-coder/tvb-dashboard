import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
const count = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    atacadoProspect: {
      findMany: (...a: unknown[]) => findMany(...a),
      count: (...a: unknown[]) => count(...a),
    },
  },
}));

describe("montarWhereQualificacao", () => {
  it("sem filtro nenhum devolve where vazio", async () => {
    const { montarWhereQualificacao } = await import("../prospeccao-qualificacao");
    expect(montarWhereQualificacao({})).toEqual({});
  });

  it("estado filtra por igualdade exata (UF), não por contains", async () => {
    const { montarWhereQualificacao } = await import("../prospeccao-qualificacao");
    expect(montarWhereQualificacao({ estado: "RJ" })).toEqual({ estado: "RJ" });
  });

  it("município filtra por contains case-insensitive", async () => {
    const { montarWhereQualificacao } = await import("../prospeccao-qualificacao");
    expect(montarWhereQualificacao({ municipio: "Niterói" })).toEqual({
      cidade: { contains: "Niterói", mode: "insensitive" },
    });
  });

  it("capital=capital filtra capitalEstadual true; interior filtra false", async () => {
    const { montarWhereQualificacao } = await import("../prospeccao-qualificacao");
    expect(montarWhereQualificacao({ capital: "capital" })).toEqual({ capitalEstadual: true });
    expect(montarWhereQualificacao({ capital: "interior" })).toEqual({ capitalEstadual: false });
  });

  it("classificacao filtra classificacaoProspect", async () => {
    const { montarWhereQualificacao } = await import("../prospeccao-qualificacao");
    expect(montarWhereQualificacao({ classificacao: "ALTA_PRIORIDADE" })).toEqual({
      classificacaoProspect: "ALTA_PRIORIDADE",
    });
  });

  it("combina todos os filtros ao mesmo tempo", async () => {
    const { montarWhereQualificacao } = await import("../prospeccao-qualificacao");
    expect(
      montarWhereQualificacao({ estado: "SC", municipio: "Floripa", capital: "interior", classificacao: "QUALIFICADO" }),
    ).toEqual({
      estado: "SC",
      cidade: { contains: "Floripa", mode: "insensitive" },
      capitalEstadual: false,
      classificacaoProspect: "QUALIFICADO",
    });
  });
});

describe("listarAprovados / listarPendentesRevisao / listarReprovados", () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([]);
  });

  it("listarAprovados filtra por statusComercial APROVADO e inclui brands+activities", async () => {
    const { listarAprovados } = await import("../prospeccao-qualificacao");
    await listarAprovados({ estado: "RJ" });
    const args = findMany.mock.calls[0][0];
    expect(args.where.statusComercial).toBe("APROVADO");
    expect(args.where.estado).toBe("RJ");
    expect(args.include.brands).toBeTruthy();
    expect(args.include.activities).toBeTruthy();
  });

  it("listarPendentesRevisao filtra por PENDENTE_REVISAO_HUMANA e não mistura com aprovados", async () => {
    const { listarPendentesRevisao } = await import("../prospeccao-qualificacao");
    await listarPendentesRevisao({});
    const args = findMany.mock.calls[0][0];
    expect(args.where.statusComercial).toBe("PENDENTE_REVISAO_HUMANA");
  });

  it("listarReprovados filtra por REPROVADO", async () => {
    const { listarReprovados } = await import("../prospeccao-qualificacao");
    await listarReprovados({});
    const args = findMany.mock.calls[0][0];
    expect(args.where.statusComercial).toBe("REPROVADO");
  });
});

describe("contarPorStatusComercial", () => {
  it("conta cada status comercial, a alta-prioridade dentro dos aprovados e separa EM_INVESTIGACAO por resultadoEliminacao (null = aguardando; INCONCLUSIVO = evidência insuficiente)", async () => {
    count.mockReset();
    count
      .mockResolvedValueOnce(10) // aprovado
      .mockResolvedValueOnce(4) // altaPrioridade
      .mockResolvedValueOnce(6) // qualificado
      .mockResolvedValueOnce(3) // pendente
      .mockResolvedValueOnce(50) // aguardandoInvestigacao (resultadoEliminacao: null)
      .mockResolvedValueOnce(7) // emInvestigacaoComEvidenciaInsuficiente (resultadoEliminacao: INCONCLUSIVO)
      .mockResolvedValueOnce(2); // reprovado
    const { contarPorStatusComercial } = await import("../prospeccao-qualificacao");
    const resultado = await contarPorStatusComercial();
    expect(resultado).toEqual({
      aprovado: 10,
      altaPrioridade: 4,
      qualificado: 6,
      pendente: 3,
      aguardandoInvestigacao: 50,
      emInvestigacaoComEvidenciaInsuficiente: 7,
      reprovado: 2,
    });
    // Garante que a separação usa resultadoEliminacao (não inventa um status novo no schema).
    expect(count.mock.calls[4][0]).toEqual({ where: { statusComercial: "EM_INVESTIGACAO", resultadoEliminacao: null } });
    expect(count.mock.calls[5][0]).toEqual({ where: { statusComercial: "EM_INVESTIGACAO", resultadoEliminacao: "INCONCLUSIVO" } });
  });
});

describe("parseScoreDetalhe", () => {
  it("retorna null para json ausente/malformado em vez de lançar", async () => {
    const { parseScoreDetalhe } = await import("../prospeccao-qualificacao");
    expect(parseScoreDetalhe(null)).toBeNull();
    expect(parseScoreDetalhe(undefined)).toBeNull();
    expect(parseScoreDetalhe("texto")).toBeNull();
    expect(parseScoreDetalhe([1, 2, 3])).toBeNull();
    expect(parseScoreDetalhe({ foo: "bar" })).toBeNull();
  });

  it("extrai total/classificacao/subScores de um shape válido", async () => {
    const { parseScoreDetalhe } = await import("../prospeccao-qualificacao");
    const resultado = parseScoreDetalhe({
      total: 82,
      classificacao: "QUALIFICADO",
      subScores: [{ criterio: "MULTIMARCAS", pontos: 25, maximo: 30, rationale: "3 marcas confirmadas" }],
    });
    expect(resultado).toEqual({
      total: 82,
      classificacao: "QUALIFICADO",
      subScores: [{ criterio: "MULTIMARCAS", pontos: 25, maximo: 30, rationale: "3 marcas confirmadas" }],
    });
  });

  it("subScores ausente ou corrompido não impede ler total/classificacao", async () => {
    const { parseScoreDetalhe } = await import("../prospeccao-qualificacao");
    expect(parseScoreDetalhe({ total: 90, classificacao: "ALTA_PRIORIDADE" })).toEqual({
      total: 90,
      classificacao: "ALTA_PRIORIDADE",
      subScores: [],
    });
    expect(parseScoreDetalhe({ total: 90, classificacao: "ALTA_PRIORIDADE", subScores: "nao-e-array" })).toEqual({
      total: 90,
      classificacao: "ALTA_PRIORIDADE",
      subScores: [],
    });
  });
});

describe("parseEvidenciasQualificacao", () => {
  it("retorna null para json ausente/malformado/vazio", async () => {
    const { parseEvidenciasQualificacao } = await import("../prospeccao-qualificacao");
    expect(parseEvidenciasQualificacao(null)).toBeNull();
    expect(parseEvidenciasQualificacao("texto")).toBeNull();
    expect(parseEvidenciasQualificacao({})).toBeNull();
  });

  it("extrai criterios e motivosReprovacao de um shape válido", async () => {
    const { parseEvidenciasQualificacao } = await import("../prospeccao-qualificacao");
    const resultado = parseEvidenciasQualificacao({
      criterios: [{ id: "MULTIMARCAS", resultado: "ATENDE", motivo: "3 marcas com evidência" }],
      motivosReprovacao: [],
    });
    expect(resultado).toEqual({
      criterios: [{ id: "MULTIMARCAS", resultado: "ATENDE", motivo: "3 marcas com evidência" }],
      motivosReprovacao: [],
    });
  });
});
