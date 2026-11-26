import { describe, it, expect, vi, beforeEach } from "vitest";
import { avaliarDecisaoCompra, type DecisaoParaAvaliar, type DadosCruzadosDecisao } from "../planejamento-avaliacao";
import { TipoCompraProduto } from "@prisma/client";

// --- Testes do núcleo PURO (avaliarDecisaoCompra) --------------------------------------------
// diagnosticarVariante (distribuicao-estoque.ts) é usada de verdade (não mockada) — mesma
// convenção de planejamentoEstoque.test.ts, pra testar a integração real com a régua do resto do
// Radar, não uma cópia da lógica.

function baseDecisao(overrides: Partial<DecisaoParaAvaliar> = {}): DecisaoParaAvaliar {
  return {
    id: "dec-1",
    cod: "COD-1",
    grupo: "Bonés",
    tipoCompra: TipoCompraProduto.BEST_SELLER,
    quantidadeSugerida: 100,
    quantidadeAprovada: 120,
    decididoEm: new Date("2026-08-01T00:00:00Z"),
    decididoPor: "rodrigo@tvb.com",
    ...overrides,
  };
}

function dadosVazios(overrides: Partial<DadosCruzadosDecisao> = {}): DadosCruzadosDecisao {
  return {
    stockRowCount: 0,
    estoqueAtual: 0,
    vendasNoPeriodoCount: 0,
    vendasPosDecisaoAteAgora: 0,
    vendasPosDecisao30: null,
    vendasPosDecisao60: null,
    vendasPosDecisao90: null,
    ...overrides,
  };
}

const AGORA = new Date("2026-11-16T00:00:00Z"); // ~107 dias depois de 2026-08-01 — janela de 90 cheia

describe("avaliarDecisaoCompra — classificação de avaliabilidade", () => {
  it("SEM_DADOS quando decisão não tem cod (só grupo) e não há venda/estoque cruzável no período", () => {
    const decisao = baseDecisao({ cod: null });
    const dados = dadosVazios();

    const resultado = avaliarDecisaoCompra(decisao, dados, AGORA);

    expect(resultado.avaliabilidade).toBe("SEM_DADOS");
    expect(resultado.baseCalculo).toBeNull();
    expect(resultado.vendasPosDecisaoAteAgora).toBeNull();
    expect(resultado.vendasPosDecisao30).toBeNull();
    expect(resultado.vendasPosDecisao60).toBeNull();
    expect(resultado.vendasPosDecisao90).toBeNull();
    expect(resultado.estoqueAtual).toBeNull();
    expect(resultado.diagnosticoPosDecisao).toBeNull();
    expect(resultado.indicioRupturaPosDecisao).toBeNull();
    expect(resultado.indicioExcessoRemanescente).toBeNull();
    expect(resultado.avisos.length).toBeGreaterThan(0);
    // Fatos que vêm direto da própria DecisaoCompra continuam presentes mesmo em SEM_DADOS —
    // nunca escondemos o que já era sabido antes de qualquer cruzamento.
    expect(resultado.quantidadeRecomendada).toBe(100);
    expect(resultado.quantidadeComprada).toBe(120);
    expect(resultado.diferenca).toBe(20);
  });

  it("SEM_DADOS também quando a decisão TEM cod mas o cod não tem nenhum StockSnapshot/Sale cruzável", () => {
    const decisao = baseDecisao({ cod: "COD-DESCONTINUADO" });
    const dados = dadosVazios();

    const resultado = avaliarDecisaoCompra(decisao, dados, AGORA);

    expect(resultado.avaliabilidade).toBe("SEM_DADOS");
    expect(resultado.baseCalculo).toBeNull();
    expect(resultado.estoqueAtual).toBeNull();
  });

  it("PARCIAL quando decisão só tem grupo mas há alguma venda/estoque cruzável — NUNCA chega a COMPLETA, mesmo com muito tempo decorrido", () => {
    const decisao = baseDecisao({ cod: null, decididoEm: new Date("2025-01-01T00:00:00Z") }); // quase 2 anos atrás
    const dados = dadosVazios({
      stockRowCount: 3,
      estoqueAtual: 50,
      vendasNoPeriodoCount: 10,
      vendasPosDecisaoAteAgora: 500,
      vendasPosDecisao30: 60,
      vendasPosDecisao60: 110,
      vendasPosDecisao90: 150,
    });

    const resultado = avaliarDecisaoCompra(decisao, dados, AGORA);

    expect(resultado.avaliabilidade).toBe("PARCIAL");
    expect(resultado.baseCalculo).toBe("grupo");
    expect(resultado.vendasPosDecisao90).toBe(150);
    expect(resultado.estoqueAtual).toBe(50);
    // Sem cod, nunca calculamos diagnóstico de ruptura/excesso — seria atribuir a um SKU algo que
    // é, na verdade, a mistura de todo o grupo.
    expect(resultado.diagnosticoPosDecisao).toBeNull();
    expect(resultado.indicioRupturaPosDecisao).toBeNull();
    expect(resultado.indicioExcessoRemanescente).toBeNull();
  });

  it("PARCIAL quando decisão tem cod mas o período pós-decisão ainda é curto — reporta só o que já decorreu, nunca completa o que falta", () => {
    const decisao = baseDecisao({ decididoEm: new Date("2026-11-10T00:00:00Z") }); // 6 dias atrás
    const dados = dadosVazios({
      stockRowCount: 2,
      estoqueAtual: 30,
      vendasNoPeriodoCount: 4,
      vendasPosDecisaoAteAgora: 12,
      vendasPosDecisao30: null, // 30 dias NÃO decorreram ainda
      vendasPosDecisao60: null,
      vendasPosDecisao90: null,
    });

    const resultado = avaliarDecisaoCompra(decisao, dados, AGORA);

    expect(resultado.avaliabilidade).toBe("PARCIAL");
    expect(resultado.baseCalculo).toBe("cod");
    expect(resultado.diasDecorridos).toBe(6);
    expect(resultado.vendasPosDecisaoAteAgora).toBe(12);
    expect(resultado.vendasPosDecisao30).toBeNull();
    expect(resultado.vendasPosDecisao60).toBeNull();
    expect(resultado.vendasPosDecisao90).toBeNull();
    expect(resultado.estoqueAtual).toBe(30);
    expect(resultado.diagnosticoPosDecisao).toBeNull();
  });

  it("COMPLETA quando decisão tem cod, janela de 90 dias cheia decorreu, e há dado real disponível", () => {
    const decisao = baseDecisao({ decididoEm: new Date("2026-08-01T00:00:00Z") });
    const dados = dadosVazios({
      stockRowCount: 2,
      estoqueAtual: 40,
      vendasNoPeriodoCount: 30,
      vendasPosDecisaoAteAgora: 300,
      vendasPosDecisao30: 90,
      vendasPosDecisao60: 180,
      vendasPosDecisao90: 270, // velocidade = 3/dia; cobertura = 40/3 ≈ 13.3 dias -> equilibrado
    });

    const resultado = avaliarDecisaoCompra(decisao, dados, AGORA);

    expect(resultado.avaliabilidade).toBe("COMPLETA");
    expect(resultado.baseCalculo).toBe("cod");
    expect(resultado.vendasPosDecisao30).toBe(90);
    expect(resultado.vendasPosDecisao60).toBe(180);
    expect(resultado.vendasPosDecisao90).toBe(270);
    expect(resultado.estoqueAtual).toBe(40);
    expect(resultado.diagnosticoPosDecisao).toBe("equilibrado");
    expect(resultado.indicioRupturaPosDecisao).toBe(false);
    expect(resultado.indicioExcessoRemanescente).toBe(false);
  });

  it("COMPLETA detecta ruptura pós-decisão real (estoque zerado, venda comprovada) via a mesma régua de diagnosticarVariante", () => {
    const decisao = baseDecisao({ decididoEm: new Date("2026-08-01T00:00:00Z") });
    const dados = dadosVazios({
      stockRowCount: 1,
      estoqueAtual: 0,
      vendasNoPeriodoCount: 20,
      vendasPosDecisaoAteAgora: 200,
      vendasPosDecisao30: 60,
      vendasPosDecisao60: 130,
      vendasPosDecisao90: 200,
    });

    const resultado = avaliarDecisaoCompra(decisao, dados, AGORA);

    expect(resultado.avaliabilidade).toBe("COMPLETA");
    expect(resultado.diagnosticoPosDecisao).toBe("ruptura");
    expect(resultado.indicioRupturaPosDecisao).toBe(true);
    expect(resultado.indicioExcessoRemanescente).toBe(false);
  });

  it('nunca inventa resultado histórico quando não há dados suficientes (PARCIAL preserva null em vez de estimar)', () => {
    // Janela de 30 dias já decorreu (temos o número), mas 60 e 90 ainda não — provando que a
    // função NUNCA extrapola/estima os campos que faltam a partir do que já tem.
    const decisao = baseDecisao({ decididoEm: new Date("2026-10-20T00:00:00Z") }); // ~27 dias atrás de AGORA
    const dados = dadosVazios({
      stockRowCount: 1,
      estoqueAtual: 15,
      vendasNoPeriodoCount: 5,
      vendasPosDecisaoAteAgora: 40,
      vendasPosDecisao30: null, // nem os 30 dias decorreram ainda neste cenário
      vendasPosDecisao60: null,
      vendasPosDecisao90: null,
    });

    const resultado = avaliarDecisaoCompra(decisao, dados, AGORA);

    expect(resultado.avaliabilidade).toBe("PARCIAL");
    // Os três campos de janela fixa continuam null — nenhum número foi fabricado a partir de
    // vendasPosDecisaoAteAgora (que É conhecido: 40) pra "completar" 30/60/90.
    expect(resultado.vendasPosDecisao30).toBeNull();
    expect(resultado.vendasPosDecisao60).toBeNull();
    expect(resultado.vendasPosDecisao90).toBeNull();
    // E por não ter janela completa, nenhum diagnóstico/indício é calculado — null explícito, não
    // um valor "default" (false) que poderia ser lido como "confirmadamente sem ruptura/excesso".
    expect(resultado.diagnosticoPosDecisao).toBeNull();
    expect(resultado.indicioRupturaPosDecisao).toBeNull();
    expect(resultado.indicioExcessoRemanescente).toBeNull();
    // E a razão disso está documentada no aviso, não só implícita no retorno.
    expect(resultado.avisos.some((a) => a.includes("90 dias"))).toBe(true);
  });
});

// --- Testes da camada de dado (Prisma mockado + getHistoricoDecisoesCompra mockada) -----------

const decisaoCompraFindMany = vi.fn();
const stockSnapshotAggregate = vi.fn();
const saleAggregate = vi.fn();
const saleCount = vi.fn();
const returnAggregate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    decisaoCompra: { findMany: (...a: unknown[]) => decisaoCompraFindMany(...a) },
    stockSnapshot: { aggregate: (...a: unknown[]) => stockSnapshotAggregate(...a) },
    sale: {
      aggregate: (...a: unknown[]) => saleAggregate(...a),
      count: (...a: unknown[]) => saleCount(...a),
    },
    // Líquida de devolução (achado 1, auditoria 2026-11-26) — default zero em todo teste que não
    // configura devolução explicitamente, pra manter o número bruto já esperado pelos cenários
    // existentes (sem devolução = sem mudança).
    return: { aggregate: (...a: unknown[]) => returnAggregate(...a) },
  },
}));

beforeEach(() => {
  decisaoCompraFindMany.mockReset();
  stockSnapshotAggregate.mockReset().mockResolvedValue({ _sum: { quantidadeDisponivel: 0 }, _count: 0 });
  saleAggregate.mockReset().mockResolvedValue({ _sum: { quantidade: 0 } });
  saleCount.mockReset().mockResolvedValue(0);
  returnAggregate.mockReset().mockResolvedValue({ _sum: { quantidade: 0 } });
});

describe("getAvaliacaoDecisaoCompra — reaproveita getHistoricoDecisoesCompra, nunca duplica leitura de DecisaoCompra", () => {
  it("retorna null quando o id não existe entre as decisões lidas", async () => {
    decisaoCompraFindMany.mockResolvedValue([]);
    const { getAvaliacaoDecisaoCompra } = await import("../planejamento-avaliacao");

    const resultado = await getAvaliacaoDecisaoCompra("inexistente");

    expect(resultado).toBeNull();
  });

  it("busca a decisão via a MESMA tabela/forma que getHistoricoDecisoesCompra usa (prisma.decisaoCompra.findMany), nunca um findUnique paralelo", async () => {
    decisaoCompraFindMany.mockResolvedValue([
      {
        id: "dec-9",
        cod: "COD-9",
        grupo: "Bonés",
        tipoCompra: TipoCompraProduto.DROP,
        quantidadeSugerida: 10,
        quantidadeAprovada: 8,
        justificativaAjuste: null,
        premissas: {},
        decididoEm: new Date("2026-11-15T00:00:00Z"), // 1 dia atrás — janela não decorreu
        decididoPor: "rodrigo@tvb.com",
      },
    ]);
    stockSnapshotAggregate.mockResolvedValue({ _sum: { quantidadeDisponivel: 5 }, _count: 1 });
    saleAggregate.mockResolvedValue({ _sum: { quantidade: 2 } });
    saleCount.mockResolvedValue(1);

    const { getAvaliacaoDecisaoCompra } = await import("../planejamento-avaliacao");
    const resultado = await getAvaliacaoDecisaoCompra("dec-9");

    expect(decisaoCompraFindMany).toHaveBeenCalledTimes(1);
    expect(resultado).not.toBeNull();
    expect(resultado!.decisaoId).toBe("dec-9");
    expect(resultado!.quantidadeRecomendada).toBe(10);
    expect(resultado!.quantidadeComprada).toBe(8);
    expect(resultado!.diferenca).toBe(-2);
    // Janela de 30 dias não decorreu (decisão foi há 1 dia) — PARCIAL, nunca COMPLETA.
    expect(resultado!.avaliabilidade).toBe("PARCIAL");
    expect(resultado!.vendasPosDecisao30).toBeNull();
  });
});

describe("getAvaliacaoDecisoesPorProdutoGrupoPeriodo", () => {
  it("filtra decididoDesde/decididoAte em memória sobre o resultado de getHistoricoDecisoesCompra", async () => {
    decisaoCompraFindMany.mockResolvedValue([
      {
        id: "dec-antiga",
        cod: "COD-1",
        grupo: "Bonés",
        tipoCompra: TipoCompraProduto.BEST_SELLER,
        quantidadeSugerida: 10,
        quantidadeAprovada: 10,
        justificativaAjuste: null,
        premissas: {},
        decididoEm: new Date("2026-01-01T00:00:00Z"),
        decididoPor: null,
      },
      {
        id: "dec-recente",
        cod: "COD-2",
        grupo: "Bonés",
        tipoCompra: TipoCompraProduto.BEST_SELLER,
        quantidadeSugerida: 20,
        quantidadeAprovada: 20,
        justificativaAjuste: null,
        premissas: {},
        decididoEm: new Date("2026-11-01T00:00:00Z"),
        decididoPor: null,
      },
    ]);

    const { getAvaliacaoDecisoesPorProdutoGrupoPeriodo } = await import("../planejamento-avaliacao");
    const resultado = await getAvaliacaoDecisoesPorProdutoGrupoPeriodo({ decididoDesde: new Date("2026-06-01T00:00:00Z") });

    expect(resultado).toHaveLength(1);
    expect(resultado[0].decisaoId).toBe("dec-recente");
  });
});
