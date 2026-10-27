import { describe, it, expect, vi, beforeEach } from "vitest";
import { PossibilidadeReposicao, StatusComercialProduto, TipoCompraProduto } from "@prisma/client";

const saleFindMany = vi.fn();
const stockFindMany = vi.fn();
const classificacaoFindMany = vi.fn();
const classificacaoFindUnique = vi.fn();
const classificacaoUpsert = vi.fn();
const historicoCreateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sale: { findMany: (...a: unknown[]) => saleFindMany(...a) },
    stockSnapshot: { findMany: (...a: unknown[]) => stockFindMany(...a) },
    classificacaoProduto: {
      findMany: (...a: unknown[]) => classificacaoFindMany(...a),
      findUnique: (...a: unknown[]) => classificacaoFindUnique(...a),
      upsert: (...a: unknown[]) => classificacaoUpsert(...a),
    },
    classificacaoProdutoHistorico: {
      createMany: (...a: unknown[]) => historicoCreateMany(...a),
    },
  },
}));

describe("getFilaRevisaoClassificacao", () => {
  beforeEach(() => {
    saleFindMany.mockReset();
    stockFindMany.mockReset();
    classificacaoFindMany.mockReset();
  });

  // Cenário 11.7: produto sem classificação definida -> fila de revisão, nunca default automático.
  it("produto com venda mas sem linha em ClassificacaoProduto aparece na fila", async () => {
    saleFindMany.mockResolvedValue([{ cod: "COD-NOVO", produto: "Camiseta Nova", grupo: "Camisetas", colecao: null }]);
    stockFindMany.mockResolvedValue([]);
    classificacaoFindMany.mockResolvedValue([]); // nenhum classificado ainda

    const { getFilaRevisaoClassificacao } = await import("../compras-inteligencia");
    const fila = await getFilaRevisaoClassificacao();

    expect(fila).toHaveLength(1);
    expect(fila[0].cod).toBe("COD-NOVO");
  });

  it("produto já classificado NÃO aparece na fila de revisão", async () => {
    saleFindMany.mockResolvedValue([{ cod: "COD-JA-CLASSIFICADO", produto: "Camiseta X", grupo: "Camisetas", colecao: null }]);
    stockFindMany.mockResolvedValue([]);
    classificacaoFindMany.mockResolvedValue([{ cod: "COD-JA-CLASSIFICADO" }]);

    const { getFilaRevisaoClassificacao } = await import("../compras-inteligencia");
    const fila = await getFilaRevisaoClassificacao();

    expect(fila).toHaveLength(0);
  });
});

describe("upsertClassificacaoProduto", () => {
  beforeEach(() => {
    classificacaoFindUnique.mockReset();
    classificacaoUpsert.mockReset();
    historicoCreateMany.mockReset();
  });

  // Cenário 11.11: produto com classificação alterada de Drop para Best Seller (ou vice-versa) ->
  // registra no histórico o campo que mudou.
  it("reclassificar de DROP para BEST_SELLER grava diff no histórico", async () => {
    classificacaoFindUnique.mockResolvedValue({
      id: "cls-1",
      cod: "COD-1",
      produto: "Camiseta X",
      grupo: "Camisetas",
      colecao: "Drop Verão",
      tipoCompra: TipoCompraProduto.DROP,
      statusComercial: StatusComercialProduto.ATIVO,
      possibilidadeReposicao: PossibilidadeReposicao.A_CONFIRMAR,
      dataLancamento: null,
      dataEncerramentoPrevista: null,
      orcamentoDrop: null,
      observacoes: null,
    });
    classificacaoUpsert.mockResolvedValue({ id: "cls-1", cod: "COD-1" });

    const { upsertClassificacaoProduto } = await import("../compras-inteligencia");
    await upsertClassificacaoProduto(
      {
        cod: "COD-1",
        produto: "Camiseta X",
        grupo: "Camisetas",
        tipoCompra: TipoCompraProduto.BEST_SELLER,
        statusComercial: StatusComercialProduto.ATIVO,
        possibilidadeReposicao: PossibilidadeReposicao.SIM,
      },
      "rodrigo@tvb.com"
    );

    expect(historicoCreateMany).toHaveBeenCalledTimes(1);
    const data = (historicoCreateMany.mock.calls[0][0] as { data: { campo: string; valorAnterior: string | null; valorNovo: string | null }[] }).data;
    const campoTipoCompra = data.find((d) => d.campo === "tipoCompra");
    expect(campoTipoCompra?.valorAnterior).toBe("DROP");
    expect(campoTipoCompra?.valorNovo).toBe("BEST_SELLER");
  });

  it("primeira classificação (produto novo) não gera histórico — não existe 'antes' pra comparar", async () => {
    classificacaoFindUnique.mockResolvedValue(null);
    classificacaoUpsert.mockResolvedValue({ id: "cls-novo", cod: "COD-NOVO" });

    const { upsertClassificacaoProduto } = await import("../compras-inteligencia");
    await upsertClassificacaoProduto({
      cod: "COD-NOVO",
      produto: "Camiseta Nova",
      grupo: "Camisetas",
      tipoCompra: TipoCompraProduto.BEST_SELLER,
      statusComercial: StatusComercialProduto.ATIVO,
      possibilidadeReposicao: PossibilidadeReposicao.SIM,
    });

    expect(historicoCreateMany).not.toHaveBeenCalled();
  });

  it("sem mudança nenhuma -> não grava histórico vazio", async () => {
    const existente = {
      id: "cls-1",
      cod: "COD-1",
      produto: "Camiseta X",
      grupo: "Camisetas",
      colecao: null,
      tipoCompra: TipoCompraProduto.BEST_SELLER,
      statusComercial: StatusComercialProduto.ATIVO,
      possibilidadeReposicao: PossibilidadeReposicao.SIM,
      dataLancamento: null,
      dataEncerramentoPrevista: null,
      orcamentoDrop: null,
      observacoes: null,
    };
    classificacaoFindUnique.mockResolvedValue(existente);
    classificacaoUpsert.mockResolvedValue(existente);

    const { upsertClassificacaoProduto } = await import("../compras-inteligencia");
    await upsertClassificacaoProduto({
      cod: "COD-1",
      produto: "Camiseta X",
      grupo: "Camisetas",
      tipoCompra: TipoCompraProduto.BEST_SELLER,
      statusComercial: StatusComercialProduto.ATIVO,
      possibilidadeReposicao: PossibilidadeReposicao.SIM,
    });

    expect(historicoCreateMany).not.toHaveBeenCalled();
  });
});
