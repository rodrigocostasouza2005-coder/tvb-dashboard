import { describe, it, expect, vi, beforeEach } from "vitest";

// Mesmo padrão de mock de classificarProdutoEmLote.test.ts — classificarProdutoAction é a action
// usada na fila de revisão (alertas-view.tsx), que só lista cods SEM nenhuma linha em
// ClassificacaoProduto ainda: por definição esta action é sempre CRIAÇÃO.
const sessionUser = { role: "GESTAO", email: "gestao@tvb.com" };

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => sessionUser),
}));

const classificacaoProdutoUpsert = vi.fn();
const classificacaoProdutoFindUnique = vi.fn();
const classificacaoProdutoHistoricoCreateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    classificacaoProduto: {
      upsert: (...a: unknown[]) => classificacaoProdutoUpsert(...a),
      findUnique: (...a: unknown[]) => classificacaoProdutoFindUnique(...a),
    },
    classificacaoProdutoHistorico: { createMany: (...a: unknown[]) => classificacaoProdutoHistoricoCreateMany(...a) },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function formDataClassificar(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("cod", overrides.cod ?? "COD-1");
  fd.set("produto", overrides.produto ?? "Camisa Polo");
  fd.set("grupo", overrides.grupo ?? "Polos");
  fd.set("tipoCompra", overrides.tipoCompra ?? "BEST_SELLER");
  fd.set("statusComercial", overrides.statusComercial ?? "ATIVO");
  fd.set("possibilidadeReposicao", overrides.possibilidadeReposicao ?? "SIM");
  if (overrides.dataLancamento !== undefined) {
    fd.set("dataLancamento", overrides.dataLancamento);
  } else {
    fd.set("dataLancamento", "2026-11-19");
  }
  return fd;
}

describe("classificarProdutoAction — dataLancamento obrigatória pra classificação nova", () => {
  beforeEach(() => {
    classificacaoProdutoUpsert.mockReset();
    classificacaoProdutoFindUnique.mockReset().mockResolvedValue(null); // fila de revisão = sempre sem classificação ainda
    classificacaoProdutoHistoricoCreateMany.mockReset();
  });

  // Decisão do Rodrigo (2026-11-19): instituir preenchimento sistemático de dataLancamento daqui
  // pra frente, sem retroagir aos ~2681 cods já classificados sem essa data (cobertura real hoje:
  // 0,04%). A fila de revisão só classifica cod NOVO, então aqui a exigência vale sempre.
  it("classifica normalmente quando dataLancamento é informada", async () => {
    classificacaoProdutoUpsert.mockResolvedValue({ id: "cls-1", cod: "COD-1" });

    const { classificarProdutoAction } = await import("../classificacao-actions");
    await classificarProdutoAction(formDataClassificar());

    expect(classificacaoProdutoUpsert).toHaveBeenCalledTimes(1);
    const create = (classificacaoProdutoUpsert.mock.calls[0][0] as { create: { dataLancamento: Date | null } }).create;
    expect(create.dataLancamento).toBeInstanceOf(Date);
  });

  it("rejeita a classificação quando dataLancamento não foi informada — nenhum upsert acontece", async () => {
    const { classificarProdutoAction } = await import("../classificacao-actions");
    await classificarProdutoAction(formDataClassificar({ dataLancamento: "" }));

    expect(classificacaoProdutoUpsert).not.toHaveBeenCalled();
  });

  it("rejeita quando dataLancamento é uma data inválida", async () => {
    const { classificarProdutoAction } = await import("../classificacao-actions");
    await classificarProdutoAction(formDataClassificar({ dataLancamento: "não-é-uma-data" }));

    expect(classificacaoProdutoUpsert).not.toHaveBeenCalled();
  });

  it("exige sessão com role ADMIN/GESTAO — rejeita VENDEDOR, nenhum upsert acontece", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth", () => ({ getSessionUser: vi.fn(async () => ({ role: "VENDEDOR", email: "v@tvb.com" })) }));

    const { classificarProdutoAction } = await import("../classificacao-actions");
    await expect(classificarProdutoAction(formDataClassificar())).rejects.toThrow("Sem permissão.");
    expect(classificacaoProdutoUpsert).not.toHaveBeenCalled();

    // Restaura o mock original (GESTAO) pros testes seguintes — mesmo cuidado de
    // classificarProdutoEmLote.test.ts (doUnmock sozinho quebraria os testes seguintes).
    vi.resetModules();
    vi.doMock("@/lib/auth", () => ({ getSessionUser: vi.fn(async () => sessionUser) }));
  });
});
