import { describe, it, expect, vi, beforeEach } from "vitest";

const findManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contatoMarcado: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

describe("getClientesContatadosRecente — cooldown de 30 dias da Sugestão de Contato", () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  it("bloqueia cliente contatado via sugestão dentro da janela", async () => {
    findManyMock.mockResolvedValue([{ cliente: "Fulana de Tal" }]);
    const { getClientesContatadosRecente } = await import("../contato-vendedor");
    const set = await getClientesContatadosRecente();
    expect(set.has("FULANA DE TAL")).toBe(true);
  });

  it("bloqueia cliente contatado via follow-up — mesmo cooldown vale pra qualquer tipo de contato", async () => {
    // Antes da correção (2026-10-08), a query filtrava tipo="sugestao" e ignorava "followup" —
    // um cliente que recebia follow-up podia reaparecer em Sugestão de Contato poucos dias depois.
    findManyMock.mockResolvedValue([{ cliente: "Ciclano da Silva" }]);
    const { getClientesContatadosRecente } = await import("../contato-vendedor");
    await getClientesContatadosRecente();

    // A chamada ao banco não deve mais restringir por `tipo` — qualquer ContatoMarcado recente
    // (sugestao ou followup) conta pro cooldown.
    const whereArg = findManyMock.mock.calls[0][0].where;
    expect(whereArg.tipo).toBeUndefined();
    expect(whereArg.contatadoEm).toBeDefined();
  });

  it("não bloqueia cliente diferente do contatado", async () => {
    findManyMock.mockResolvedValue([{ cliente: "Fulana de Tal" }]);
    const { getClientesContatadosRecente } = await import("../contato-vendedor");
    const set = await getClientesContatadosRecente();
    expect(set.has("OUTRO CLIENTE")).toBe(false);
  });
});
