import { describe, it, expect, vi, beforeEach } from "vitest";

// Auditoria pós-incidente 2026-11-25: o incidente de 24/11 (~39h sem nenhuma sincronização)
// ficou invisível até alguém abrir o painel dias depois — o indicador visual "Atrasado" exige um
// humano olhando a tela, nunca avisa proativamente. alertarSeRecuperandoDeGapCritico fecha esse
// ponto cego: dispara no Telegram assim que QUALQUER mecanismo conseguir rodar de novo, se o gap
// desde a última sincronização bem-sucedida for anormal.

const syncLogFindFirst = vi.fn();
const syncLogFindMany = vi.fn();
const syncLockFindUnique = vi.fn();
const syncLockUpsert = vi.fn();
const sendTelegramMessageMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    syncLog: {
      findFirst: (...a: unknown[]) => syncLogFindFirst(...a),
      findMany: (...a: unknown[]) => syncLogFindMany(...a),
    },
    syncLock: {
      findUnique: (...a: unknown[]) => syncLockFindUnique(...a),
      upsert: (...a: unknown[]) => syncLockUpsert(...a),
    },
  },
}));
vi.mock("@/lib/telegram", () => ({ sendTelegramMessage: (...a: unknown[]) => sendTelegramMessageMock(...a) }));

beforeEach(() => {
  syncLogFindFirst.mockReset();
  syncLogFindMany.mockReset().mockResolvedValue([]);
  // Default: nunca alertou antes (dedup não bloqueia) — preserva o comportamento dos testes
  // antigos de alertarSeRecuperandoDeGapCritico, que não conheciam dedup.
  syncLockFindUnique.mockReset().mockResolvedValue(null);
  syncLockUpsert.mockReset().mockResolvedValue(undefined);
  sendTelegramMessageMock.mockReset().mockResolvedValue(undefined);
});

describe("alertarSeRecuperandoDeGapCritico", () => {
  it("nunca alerta quando o gap está dentro do normal (até 10h)", async () => {
    const agora = new Date("2026-11-20T12:00:00-03:00");
    syncLogFindFirst.mockResolvedValue({ startedAt: new Date("2026-11-20T05:00:00-03:00") }); // 7h atrás
    const { alertarSeRecuperandoDeGapCritico } = await import("../sync-runner");
    await alertarSeRecuperandoDeGapCritico(agora);
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it("alerta quando o gap passa de 10h (reproduz o incidente real de 24/11: ~39h)", async () => {
    const agora = new Date("2026-11-25T09:43:53-03:00");
    syncLogFindFirst.mockResolvedValue({ startedAt: new Date("2026-11-23T18:54:53-03:00") }); // ~38.8h atrás
    const { alertarSeRecuperandoDeGapCritico } = await import("../sync-runner");
    await alertarSeRecuperandoDeGapCritico(agora);
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);
    const [mensagem, opts] = sendTelegramMessageMock.mock.calls[0];
    expect(mensagem).toContain("38.8h");
    expect(opts).toEqual({ adminOnly: true });
  });

  it("nunca alerta quando nunca houve sincronização bem-sucedida (projeto novo, nada pra comparar)", async () => {
    syncLogFindFirst.mockResolvedValue(null);
    const { alertarSeRecuperandoDeGapCritico } = await import("../sync-runner");
    await alertarSeRecuperandoDeGapCritico(new Date());
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it("exatamente no limiar (10h) ainda não alerta — só acima", async () => {
    const agora = new Date("2026-11-20T10:00:00-03:00");
    syncLogFindFirst.mockResolvedValue({ startedAt: new Date("2026-11-20T00:00:00-03:00") }); // exatamente 10h
    const { alertarSeRecuperandoDeGapCritico } = await import("../sync-runner");
    await alertarSeRecuperandoDeGapCritico(agora);
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it("falha no envio do Telegram nunca propaga erro (melhor-esforço)", async () => {
    syncLogFindFirst.mockResolvedValue({ startedAt: new Date("2026-11-01T00:00:00-03:00") });
    sendTelegramMessageMock.mockRejectedValue(new Error("telegram fora do ar"));
    const { alertarSeRecuperandoDeGapCritico } = await import("../sync-runner");
    await expect(alertarSeRecuperandoDeGapCritico(new Date("2026-11-25T00:00:00-03:00"))).resolves.toBeUndefined();
  });

  // Incidente real (2026-11-26): sync travado 15h+, lock reaberto a cada ~6-7min pelo self-heal —
  // sem dedup, cada reaquisição chamaria esta função de novo com o mesmo gap grande, mandando um
  // Telegram novo a cada tentativa (spam). Dedup via SyncLock("alerta-gap-critico") evita isso.
  it("já alertou sobre este gap nos últimos 60min -> não manda de novo (evita spam durante travamento)", async () => {
    const agora = new Date("2026-11-26T15:00:00-03:00");
    syncLogFindFirst.mockResolvedValue({ startedAt: new Date("2026-11-25T20:00:00-03:00") }); // 19h atrás
    syncLockFindUnique.mockResolvedValue({ id: "alerta-gap-critico", startedAt: new Date("2026-11-26T14:50:00-03:00") }); // alertou há 10min
    const { alertarSeRecuperandoDeGapCritico } = await import("../sync-runner");
    await alertarSeRecuperandoDeGapCritico(agora);
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it("último alerta foi há mais de 60min -> volta a alertar (ainda travado, mas não é spam contínuo)", async () => {
    const agora = new Date("2026-11-26T15:00:00-03:00");
    syncLogFindFirst.mockResolvedValue({ startedAt: new Date("2026-11-25T20:00:00-03:00") });
    syncLockFindUnique.mockResolvedValue({ id: "alerta-gap-critico", startedAt: new Date("2026-11-26T13:30:00-03:00") }); // há 90min
    const { alertarSeRecuperandoDeGapCritico } = await import("../sync-runner");
    await alertarSeRecuperandoDeGapCritico(agora);
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);
    expect(syncLockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "alerta-gap-critico" } })
    );
  });
});

// Falha explícita (SyncLog.status="FAILED") hoje só aparecia no badge "falhasConsecutivas" da UI
// — ninguém sabia a menos que abrisse o dashboard. alertarSeHouveFalhaRecente fecha esse ponto
// cego mandando Telegram direto, com o mesmo dedup por fonte/60min pra não espamar.
describe("alertarSeHouveFalhaRecente", () => {
  function falhaLog(source: string, message: string, finishedAt: Date) {
    return { source, status: "FAILED", message, finishedAt, startedAt: finishedAt };
  }

  it("1 fonte com falha recente nunca alertada -> manda 1 Telegram", async () => {
    syncLogFindMany.mockResolvedValue([falhaLog("PRODUCTION", "matriz indisponível (503)", new Date("2026-11-26T14:00:00-03:00"))]);
    const { alertarSeHouveFalhaRecente } = await import("../sync-runner");
    await alertarSeHouveFalhaRecente(new Date("2026-11-26T14:30:00-03:00"));
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);
    const [mensagem, opts] = sendTelegramMessageMock.mock.calls[0];
    expect(mensagem).toContain("PRODUCTION");
    expect(mensagem).toContain("matriz indisponível (503)");
    expect(opts).toEqual({ adminOnly: true });
  });

  it("mesma fonte já alertada nos últimos 60min -> não manda de novo", async () => {
    syncLogFindMany.mockResolvedValue([falhaLog("PRODUCTION", "matriz indisponível (503)", new Date("2026-11-26T14:00:00-03:00"))]);
    syncLockFindUnique.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === "alerta-failed-PRODUCTION" ? { id: args.where.id, startedAt: new Date("2026-11-26T14:10:00-03:00") } : null
    );
    const { alertarSeHouveFalhaRecente } = await import("../sync-runner");
    await alertarSeHouveFalhaRecente(new Date("2026-11-26T14:30:00-03:00"));
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it("2 fontes falhando ao mesmo tempo -> manda 2 alertas, 1 por fonte, sem misturar", async () => {
    syncLogFindMany.mockResolvedValue([
      falhaLog("PRODUCTION", "matriz indisponível (503)", new Date("2026-11-26T14:00:00-03:00")),
      falhaLog("STOCK", "armazenadores devolveu 0 linhas", new Date("2026-11-26T14:05:00-03:00")),
    ]);
    const { alertarSeHouveFalhaRecente } = await import("../sync-runner");
    await alertarSeHouveFalhaRecente(new Date("2026-11-26T14:30:00-03:00"));
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(2);
    const mensagens = sendTelegramMessageMock.mock.calls.map((c) => c[0]);
    expect(mensagens.some((m) => m.includes("PRODUCTION"))).toBe(true);
    expect(mensagens.some((m) => m.includes("STOCK"))).toBe(true);
  });

  it("nenhuma falha recente -> não manda nada", async () => {
    syncLogFindMany.mockResolvedValue([]);
    const { alertarSeHouveFalhaRecente } = await import("../sync-runner");
    await alertarSeHouveFalhaRecente(new Date("2026-11-26T14:30:00-03:00"));
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it("falha no envio do Telegram nunca propaga erro (melhor-esforço)", async () => {
    syncLogFindMany.mockResolvedValue([falhaLog("PRODUCTION", "matriz indisponível (503)", new Date("2026-11-26T14:00:00-03:00"))]);
    sendTelegramMessageMock.mockRejectedValue(new Error("telegram fora do ar"));
    const { alertarSeHouveFalhaRecente } = await import("../sync-runner");
    await expect(alertarSeHouveFalhaRecente(new Date("2026-11-26T14:30:00-03:00"))).resolves.toBeUndefined();
  });
});
