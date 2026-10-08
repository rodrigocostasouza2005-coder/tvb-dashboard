import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks mínimos — só o necessário pra exercitar a checagem de posse (ownership) de
// desmarcarContatadoAction, sem precisar de sessão/cookie/banco reais.
const sessionUser = { name: "Login Loja", id: "u1" };
const cookieVendedor = { value: "VENDEDOR A" };

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => sessionUser),
  getVendedorAtualCookie: vi.fn(async () => cookieVendedor.value),
  setVendedorAtualCookie: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  getStoreRestriction: vi.fn(() => ["store-1"]),
}));

vi.mock("@/lib/metrics", () => ({
  getVendedoresAtivos: vi.fn(async () => ["VENDEDOR A", "VENDEDOR B"]),
}));

const findUniqueMock = vi.fn();
const deleteManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clienteVendedorAtribuicao: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
    contatoMarcado: { deleteMany: (...a: unknown[]) => deleteManyMock(...a) },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("desmarcarContatadoAction — não pode desmarcar cliente de outro vendedor", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    deleteManyMock.mockReset();
  });

  it("bloqueia quando o cliente está atribuído a OUTRO vendedor", async () => {
    findUniqueMock.mockResolvedValue({ vendedorAtual: { nome: "VENDEDOR B" } });
    const { desmarcarContatadoAction } = await import("../actions");
    await expect(desmarcarContatadoAction("sugestao", "Cliente X", "VIP esfriando")).rejects.toThrow(
      "Esse cliente não está atribuído a você."
    );
    expect(deleteManyMock).not.toHaveBeenCalled();
  });

  it("permite quando o cliente está atribuído ao PRÓPRIO vendedor logado", async () => {
    findUniqueMock.mockResolvedValue({ vendedorAtual: { nome: "VENDEDOR A" } });
    const { desmarcarContatadoAction } = await import("../actions");
    await desmarcarContatadoAction("sugestao", "Cliente X", "VIP esfriando");
    expect(deleteManyMock).toHaveBeenCalledWith({ where: { tipo: "sugestao", cliente: "Cliente X", chave: "VIP esfriando" } });
  });
});
