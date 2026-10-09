import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

  describe("fronteira exata dos 30 dias", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("o corte (cutoff) pedido ao banco é exatamente now-30d, com gte (inclusivo)", async () => {
      findManyMock.mockResolvedValue([]);
      const { getClientesContatadosRecente } = await import("../contato-vendedor");
      await getClientesContatadosRecente();

      const whereArg = findManyMock.mock.calls[0][0].where;
      const cutoff = whereArg.contatadoEm.gte as Date;
      expect(whereArg.contatadoEm.gt).toBeUndefined(); // precisa ser gte, não gt
      expect(cutoff.toISOString()).toBe(new Date("2026-09-08T12:00:00.000Z").toISOString());
    });

    it("contato de exatos 30 dias atrás ainda conta como recente (gte inclui a borda)", () => {
      // Postgres resolve o `gte` de verdade — aqui só provamos que um contatadoEm == cutoff
      // satisfaz a condição matematicamente (>=), ou seja, no dia exato dos 30, o cliente AINDA
      // está bloqueado — só fica elegível de novo a partir do dia 31.
      const cutoff = new Date(Date.now() - 30 * 86400000);
      const contatadoExatos30DiasAtras = new Date(Date.now() - 30 * 86400000);
      expect(contatadoExatos30DiasAtras.getTime() >= cutoff.getTime()).toBe(true);

      const contatado29DiasAtras = new Date(Date.now() - 29 * 86400000);
      expect(contatado29DiasAtras.getTime() >= cutoff.getTime()).toBe(true);

      const contatado31DiasAtras = new Date(Date.now() - 31 * 86400000);
      expect(contatado31DiasAtras.getTime() >= cutoff.getTime()).toBe(false);
    });
  });
});
