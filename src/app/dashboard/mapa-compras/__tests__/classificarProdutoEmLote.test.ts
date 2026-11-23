import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks mínimos — mesmo padrão de desmarcarContatado.test.ts (clientes-sugestoes-contato):
// exercita a checagem de posse/pertencimento sem precisar de sessão/cookie/banco reais.
const sessionUser = { role: "GESTAO", email: "gestao@tvb.com" };

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => sessionUser),
}));

const saleFindMany = vi.fn();
const stockSnapshotFindMany = vi.fn();
const classificacaoProdutoUpsert = vi.fn();
const classificacaoProdutoFindUnique = vi.fn();
const classificacaoProdutoHistoricoCreateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sale: { findMany: (...a: unknown[]) => saleFindMany(...a) },
    stockSnapshot: { findMany: (...a: unknown[]) => stockSnapshotFindMany(...a) },
    classificacaoProduto: {
      upsert: (...a: unknown[]) => classificacaoProdutoUpsert(...a),
      findUnique: (...a: unknown[]) => classificacaoProdutoFindUnique(...a),
    },
    classificacaoProdutoHistorico: { createMany: (...a: unknown[]) => classificacaoProdutoHistoricoCreateMany(...a) },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function formDataComCods(produto: string, cods: string[], extras: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("produto", produto);
  for (const cod of cods) fd.append("cod", cod);
  fd.set("tipoCompra", extras.tipoCompra ?? "BEST_SELLER");
  fd.set("statusComercial", extras.statusComercial ?? "ATIVO");
  fd.set("possibilidadeReposicao", extras.possibilidadeReposicao ?? "SIM");
  return fd;
}

// Grão de ClassificacaoProduto mudou de `cod` pra produto+cor em 2026-11-19/23 (ver
// prisma/schema.prisma) — classificarProdutoEmLoteAction passou a agrupar os cods válidos por
// COR real (resolvida via Sale/StockSnapshot, nunca o formulário) e fazer 1 upsert por cor
// distinta, não mais 1 upsert por cod.
describe("classificarProdutoEmLoteAction — segurança e integridade", () => {
  beforeEach(() => {
    saleFindMany.mockReset().mockResolvedValue([]);
    stockSnapshotFindMany.mockReset().mockResolvedValue([]);
    classificacaoProdutoUpsert.mockReset();
    classificacaoProdutoFindUnique.mockReset().mockResolvedValue(null);
    classificacaoProdutoHistoricoCreateMany.mockReset();
  });

  it("nunca confia no `cod` do formulário: rejeita cod que pertence a OUTRO produto na fonte real, nunca grava classificação para ele", async () => {
    // Formulário diz que "COD-INTRUSO" é da "Camisa Polo", mas a fonte real (Sale) diz que
    // pertence a "Jaqueta Drop" — simula campo oculto adulterado no cliente.
    saleFindMany.mockResolvedValue([
      { cod: "COD-1", produto: "Camisa Polo", grupo: "Polos", cor: "Azul" },
      { cod: "COD-INTRUSO", produto: "Jaqueta Drop", grupo: "Jaquetas", cor: "Preta" },
    ]);

    const { classificarProdutoEmLoteAction } = await import("../classificacao-actions");
    await classificarProdutoEmLoteAction(formDataComCods("Camisa Polo", ["COD-1", "COD-INTRUSO"]));

    expect(classificacaoProdutoUpsert).toHaveBeenCalledTimes(1);
    const produtosCorGravados = classificacaoProdutoUpsert.mock.calls.map((c) => (c[0] as { create: { produtoCor: string } }).create.produtoCor);
    expect(produtosCorGravados).toEqual(["Camisa Polo::Azul"]);
  });

  it("rejeita cod inexistente (não aparece em Sale nem StockSnapshot) — nenhum upsert fabricado", async () => {
    saleFindMany.mockResolvedValue([{ cod: "COD-1", produto: "Camisa Polo", grupo: "Polos", cor: "Azul" }]);
    stockSnapshotFindMany.mockResolvedValue([]);

    const { classificarProdutoEmLoteAction } = await import("../classificacao-actions");
    await classificarProdutoEmLoteAction(formDataComCods("Camisa Polo", ["COD-1", "COD-FANTASMA"]));

    expect(classificacaoProdutoUpsert).toHaveBeenCalledTimes(1);
  });

  it("deduplica cod repetido no formulário (reenvio) — grava 1 vez só, não 2x", async () => {
    saleFindMany.mockResolvedValue([{ cod: "COD-1", produto: "Camisa Polo", grupo: "Polos", cor: "Azul" }]);

    const { classificarProdutoEmLoteAction } = await import("../classificacao-actions");
    await classificarProdutoEmLoteAction(formDataComCods("Camisa Polo", ["COD-1", "COD-1"]));

    expect(classificacaoProdutoUpsert).toHaveBeenCalledTimes(1);
  });

  it("grupo gravado vem SEMPRE da fonte real (Sale/StockSnapshot), nunca de um valor arbitrário do formulário", async () => {
    saleFindMany.mockResolvedValue([{ cod: "COD-1", produto: "Camisa Polo", grupo: "Grupo Real Do Banco", cor: "Azul" }]);

    const { classificarProdutoEmLoteAction } = await import("../classificacao-actions");
    await classificarProdutoEmLoteAction(formDataComCods("Camisa Polo", ["COD-1"]));

    const grupoGravado = (classificacaoProdutoUpsert.mock.calls[0][0] as { create: { grupo: string } }).create.grupo;
    expect(grupoGravado).toBe("Grupo Real Do Banco");
  });

  it("não grava NADA quando nenhum cod submetido realmente pertence ao produto informado (não deixa produto sem classificação parcial/errada)", async () => {
    saleFindMany.mockResolvedValue([{ cod: "COD-X", produto: "Outro Produto Qualquer", grupo: "Outro", cor: "Azul" }]);

    const { classificarProdutoEmLoteAction } = await import("../classificacao-actions");
    await classificarProdutoEmLoteAction(formDataComCods("Camisa Polo", ["COD-X"]));

    expect(classificacaoProdutoUpsert).not.toHaveBeenCalled();
  });

  it("2 tamanhos da MESMA cor + 1 tamanho de OUTRA cor -> 1 upsert por cor distinta (2 upserts, não 3), mesma decisão nos dois", async () => {
    saleFindMany.mockResolvedValue([
      { cod: "COD-AZUL-P", produto: "Camisa Polo", grupo: "Polos", cor: "Azul" },
      { cod: "COD-AZUL-M", produto: "Camisa Polo", grupo: "Polos", cor: "Azul" },
      { cod: "COD-VERMELHO-P", produto: "Camisa Polo", grupo: "Polos", cor: "Vermelho" },
    ]);

    const { classificarProdutoEmLoteAction } = await import("../classificacao-actions");
    await classificarProdutoEmLoteAction(formDataComCods("Camisa Polo", ["COD-AZUL-P", "COD-AZUL-M", "COD-VERMELHO-P"], { tipoCompra: "DROP" }));

    expect(classificacaoProdutoUpsert).toHaveBeenCalledTimes(2);
    const produtoCors = classificacaoProdutoUpsert.mock.calls.map((c) => (c[0] as { create: { produtoCor: string } }).create.produtoCor).sort();
    expect(produtoCors).toEqual(["Camisa Polo::Azul", "Camisa Polo::Vermelho"]);
    for (const call of classificacaoProdutoUpsert.mock.calls) {
      const create = (call[0] as { create: { tipoCompra: string; produto: string } }).create;
      expect(create.tipoCompra).toBe("DROP");
      expect(create.produto).toBe("Camisa Polo");
    }
  });

  it("exige sessão com role ADMIN/GESTAO — rejeita VENDEDOR, nenhum upsert acontece", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth", () => ({ getSessionUser: vi.fn(async () => ({ role: "VENDEDOR", email: "v@tvb.com" })) }));

    const { classificarProdutoEmLoteAction } = await import("../classificacao-actions");
    await expect(classificarProdutoEmLoteAction(formDataComCods("Camisa Polo", ["COD-1"]))).rejects.toThrow("Sem permissão.");
    expect(classificacaoProdutoUpsert).not.toHaveBeenCalled();

    // Restaura o mock original (GESTAO) pros testes seguintes — doUnmock sozinho removeria o
    // mock por completo e o próximo import pegaria o módulo real de @/lib/auth (sem sessão),
    // quebrando os testes seguintes com o mesmo "Sem permissão." por um motivo diferente.
    vi.resetModules();
    vi.doMock("@/lib/auth", () => ({ getSessionUser: vi.fn(async () => sessionUser) }));
  });

  it("preserva histórico de classificação: quando o produto+cor JÁ tinha classificação diferente, grava diff em classificacaoProdutoHistorico (não apaga o que havia antes)", async () => {
    saleFindMany.mockResolvedValue([{ cod: "COD-1", produto: "Camisa Polo", grupo: "Polos", cor: "Azul" }]);
    classificacaoProdutoFindUnique.mockResolvedValue({
      id: "classif-1", produto: "Camisa Polo", cor: "Azul", produtoCor: "Camisa Polo::Azul", grupo: "Polos", colecao: null,
      tipoCompra: "DROP", statusComercial: "ATIVO", possibilidadeReposicao: "SIM",
      dataLancamento: null, dataEncerramentoPrevista: null, orcamentoDrop: null, observacoes: null,
    });
    classificacaoProdutoUpsert.mockResolvedValue({
      id: "classif-1", produto: "Camisa Polo", cor: "Azul", produtoCor: "Camisa Polo::Azul", grupo: "Polos", colecao: null,
      tipoCompra: "BEST_SELLER", statusComercial: "ATIVO", possibilidadeReposicao: "SIM",
      dataLancamento: null, dataEncerramentoPrevista: null, orcamentoDrop: null, observacoes: null,
    });

    const { classificarProdutoEmLoteAction } = await import("../classificacao-actions");
    await classificarProdutoEmLoteAction(formDataComCods("Camisa Polo", ["COD-1"], { tipoCompra: "BEST_SELLER" }));

    expect(classificacaoProdutoHistoricoCreateMany).toHaveBeenCalledTimes(1);
    const diffs = (classificacaoProdutoHistoricoCreateMany.mock.calls[0][0] as { data: { campo: string }[] }).data;
    expect(diffs.some((d) => d.campo === "tipoCompra")).toBe(true);
  });
});
