import { describe, it, expect, vi, beforeEach } from "vitest";

// Auditoria pós-incidente 2026-11-25: o incidente de 24/11 (~39h sem nenhuma sincronização)
// ficou invisível até alguém abrir o painel dias depois — o indicador visual "Atrasado" exige um
// humano olhando a tela, nunca avisa proativamente. alertarSeRecuperandoDeGapCritico fecha esse
// ponto cego: dispara no Telegram assim que QUALQUER mecanismo conseguir rodar de novo, se o gap
// desde a última sincronização bem-sucedida for anormal.

const syncLogFindFirst = vi.fn();
const sendTelegramMessageMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: { syncLog: { findFirst: (...a: unknown[]) => syncLogFindFirst(...a) } },
}));
vi.mock("@/lib/telegram", () => ({ sendTelegramMessage: (...a: unknown[]) => sendTelegramMessageMock(...a) }));

beforeEach(() => {
  syncLogFindFirst.mockReset();
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
});
