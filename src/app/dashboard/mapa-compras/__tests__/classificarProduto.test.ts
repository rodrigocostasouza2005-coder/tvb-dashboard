import { describe, it, expect, vi, beforeEach } from "vitest";

// classificarProdutoAction (form de 1 cod só, usado na fila de revisão — ver
// ClassificarProdutoForm/AlertasView) passou em 2026-11-19/23 a resolver `cor` sempre pela fonte
// real (Sale/StockSnapshot), nunca do formulário, e a gravar por produtoCor — ver
// prisma/schema.prisma e o comentário em classificacao-actions.ts.
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

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("classificarProdutoAction", () => {
  beforeEach(() => {
    saleFindMany.mockReset().mockResolvedValue([]);
    stockSnapshotFindMany.mockReset().mockResolvedValue([]);
    classificacaoProdutoUpsert.mockReset();
    classificacaoProdutoFindUnique.mockReset().mockResolvedValue(null);
    classificacaoProdutoHistoricoCreateMany.mockReset();
  });

  it("resolve a cor pela fonte real (nunca do formulário, que nem manda cor) e grava por produtoCor", async () => {
    saleFindMany.mockResolvedValue([{ produto: "Camisa Polo", grupo: "Polos", cor: "Azul" }]);

    const { classificarProdutoAction } = await import("../classificacao-actions");
    await classificarProdutoAction(
      formData({ cod: "COD-AZUL-P", produto: "Camisa Polo", grupo: "Polos", tipoCompra: "BEST_SELLER", statusComercial: "ATIVO", possibilidadeReposicao: "SIM" })
    );

    expect(classificacaoProdutoUpsert).toHaveBeenCalledTimes(1);
    const create = (classificacaoProdutoUpsert.mock.calls[0][0] as { create: { produtoCor: string; cor: string } }).create;
    expect(create.produtoCor).toBe("Camisa Polo::Azul");
    expect(create.cor).toBe("Azul");
  });

  it("cod inexistente (sem Sale/StockSnapshot) -> nenhum upsert fabricado", async () => {
    const { classificarProdutoAction } = await import("../classificacao-actions");
    await classificarProdutoAction(
      formData({ cod: "COD-FANTASMA", produto: "Camisa Polo", grupo: "Polos", tipoCompra: "BEST_SELLER", statusComercial: "ATIVO", possibilidadeReposicao: "SIM" })
    );

    expect(classificacaoProdutoUpsert).not.toHaveBeenCalled();
  });

  it("produto do formulário não bate com o produto real do cod -> rejeita, nenhum upsert", async () => {
    saleFindMany.mockResolvedValue([{ produto: "Jaqueta Drop", grupo: "Jaquetas", cor: "Preta" }]);

    const { classificarProdutoAction } = await import("../classificacao-actions");
    await classificarProdutoAction(
      formData({ cod: "COD-1", produto: "Camisa Polo", grupo: "Polos", tipoCompra: "BEST_SELLER", statusComercial: "ATIVO", possibilidadeReposicao: "SIM" })
    );

    expect(classificacaoProdutoUpsert).not.toHaveBeenCalled();
  });

  it("exige sessão com role ADMIN/GESTAO — rejeita VENDEDOR, nenhum upsert acontece", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth", () => ({ getSessionUser: vi.fn(async () => ({ role: "VENDEDOR", email: "v@tvb.com" })) }));

    const { classificarProdutoAction } = await import("../classificacao-actions");
    await expect(
      classificarProdutoAction(formData({ cod: "COD-1", produto: "Camisa Polo", grupo: "Polos", tipoCompra: "BEST_SELLER", statusComercial: "ATIVO", possibilidadeReposicao: "SIM" }))
    ).rejects.toThrow("Sem permissão.");
    expect(classificacaoProdutoUpsert).not.toHaveBeenCalled();

    vi.resetModules();
    vi.doMock("@/lib/auth", () => ({ getSessionUser: vi.fn(async () => sessionUser) }));
  });
});
