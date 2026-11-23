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

// Grão de ClassificacaoProduto mudou de `cod` pra produto+cor em 2026-11-19/23 (ver
// prisma/schema.prisma) — getFilaRevisaoClassificacao passou a checar se o produto+cor (não o
// cod literal) já está classificado, e upsertClassificacaoProduto passou a receber `cor` (nunca
// `cod`) e gravar/consultar por `produtoCor`.
describe("getFilaRevisaoClassificacao", () => {
  beforeEach(() => {
    saleFindMany.mockReset();
    stockFindMany.mockReset();
    classificacaoFindMany.mockReset();
  });

  // Cenário 11.7: produto sem classificação definida -> fila de revisão, nunca default automático.
  it("produto com venda mas sem linha em ClassificacaoProduto aparece na fila", async () => {
    saleFindMany.mockResolvedValue([{ cod: "COD-NOVO", produto: "Camiseta Nova", grupo: "Camisetas", colecao: null, cor: "Azul" }]);
    stockFindMany.mockResolvedValue([]);
    classificacaoFindMany.mockResolvedValue([]); // nenhum classificado ainda

    const { getFilaRevisaoClassificacao } = await import("../compras-inteligencia");
    const fila = await getFilaRevisaoClassificacao();

    expect(fila).toHaveLength(1);
    expect(fila[0].cod).toBe("COD-NOVO");
  });

  it("produto já classificado (mesmo produto+cor) NÃO aparece na fila de revisão", async () => {
    saleFindMany.mockResolvedValue([{ cod: "COD-JA-CLASSIFICADO", produto: "Camiseta X", grupo: "Camisetas", colecao: null, cor: "Azul" }]);
    stockFindMany.mockResolvedValue([]);
    classificacaoFindMany.mockResolvedValue([{ produtoCor: "Camiseta X::Azul" }]);

    const { getFilaRevisaoClassificacao } = await import("../compras-inteligencia");
    const fila = await getFilaRevisaoClassificacao();

    expect(fila).toHaveLength(0);
  });

  it("mesmo produto já classificado numa cor DIFERENTE ainda aparece na fila (divergência de cor é legítima, não dispensa revisão)", async () => {
    saleFindMany.mockResolvedValue([{ cod: "COD-VERDE", produto: "Camiseta X", grupo: "Camisetas", colecao: null, cor: "Verde" }]);
    stockFindMany.mockResolvedValue([]);
    classificacaoFindMany.mockResolvedValue([{ produtoCor: "Camiseta X::Azul" }]); // só a cor Azul foi classificada

    const { getFilaRevisaoClassificacao } = await import("../compras-inteligencia");
    const fila = await getFilaRevisaoClassificacao();

    expect(fila).toHaveLength(1);
    expect(fila[0].cod).toBe("COD-VERDE");
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
      produto: "Camiseta X",
      cor: "Azul",
      produtoCor: "Camiseta X::Azul",
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
    classificacaoUpsert.mockResolvedValue({ id: "cls-1", produtoCor: "Camiseta X::Azul" });

    const { upsertClassificacaoProduto } = await import("../compras-inteligencia");
    await upsertClassificacaoProduto(
      {
        produto: "Camiseta X",
        cor: "Azul",
        grupo: "Camisetas",
        tipoCompra: TipoCompraProduto.BEST_SELLER,
        statusComercial: StatusComercialProduto.ATIVO,
        possibilidadeReposicao: PossibilidadeReposicao.SIM,
      },
      "rodrigo@tvb.com"
    );

    expect(classificacaoFindUnique).toHaveBeenCalledWith({ where: { produtoCor: "Camiseta X::Azul" } });
    expect(classificacaoUpsert.mock.calls[0][0]).toMatchObject({ where: { produtoCor: "Camiseta X::Azul" } });
    expect(historicoCreateMany).toHaveBeenCalledTimes(1);
    const data = (historicoCreateMany.mock.calls[0][0] as { data: { campo: string; valorAnterior: string | null; valorNovo: string | null }[] }).data;
    const campoTipoCompra = data.find((d) => d.campo === "tipoCompra");
    expect(campoTipoCompra?.valorAnterior).toBe("DROP");
    expect(campoTipoCompra?.valorNovo).toBe("BEST_SELLER");
  });

  it("primeira classificação (produto+cor novo) não gera histórico — não existe 'antes' pra comparar", async () => {
    classificacaoFindUnique.mockResolvedValue(null);
    classificacaoUpsert.mockResolvedValue({ id: "cls-novo", produtoCor: "Camiseta Nova::Azul" });

    const { upsertClassificacaoProduto } = await import("../compras-inteligencia");
    await upsertClassificacaoProduto({
      produto: "Camiseta Nova",
      cor: "Azul",
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
      produto: "Camiseta X",
      cor: "Azul",
      produtoCor: "Camiseta X::Azul",
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
      produto: "Camiseta X",
      cor: "Azul",
      grupo: "Camisetas",
      tipoCompra: TipoCompraProduto.BEST_SELLER,
      statusComercial: StatusComercialProduto.ATIVO,
      possibilidadeReposicao: PossibilidadeReposicao.SIM,
    });

    expect(historicoCreateMany).not.toHaveBeenCalled();
  });

  it("duas cores do MESMO produto podem ter tipoCompra diferente — cada upsert é independente, por produtoCor próprio", async () => {
    classificacaoFindUnique.mockResolvedValue(null);
    classificacaoUpsert
      .mockResolvedValueOnce({ id: "cls-azul", produtoCor: "Camisa Polo::Azul" })
      .mockResolvedValueOnce({ id: "cls-verde", produtoCor: "Camisa Polo::Verde" });

    const { upsertClassificacaoProduto } = await import("../compras-inteligencia");
    await upsertClassificacaoProduto({
      produto: "Camisa Polo",
      cor: "Azul",
      grupo: "Polos",
      tipoCompra: TipoCompraProduto.BEST_SELLER,
      statusComercial: StatusComercialProduto.ATIVO,
      possibilidadeReposicao: PossibilidadeReposicao.SIM,
    });
    await upsertClassificacaoProduto({
      produto: "Camisa Polo",
      cor: "Verde",
      grupo: "Polos",
      tipoCompra: TipoCompraProduto.DROP,
      statusComercial: StatusComercialProduto.ATIVO,
      possibilidadeReposicao: PossibilidadeReposicao.A_CONFIRMAR,
    });

    expect(classificacaoUpsert).toHaveBeenCalledTimes(2);
    expect(classificacaoUpsert.mock.calls[0][0]).toMatchObject({ where: { produtoCor: "Camisa Polo::Azul" }, create: { tipoCompra: TipoCompraProduto.BEST_SELLER } });
    expect(classificacaoUpsert.mock.calls[1][0]).toMatchObject({ where: { produtoCor: "Camisa Polo::Verde" }, create: { tipoCompra: TipoCompraProduto.DROP } });
  });
});
