import { describe, it, expect, vi, beforeEach } from "vitest";

const syncLogFindFirst = vi.fn();
const runSyncMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    syncLog: { findFirst: (...a: unknown[]) => syncLogFindFirst(...a) },
  },
}));

vi.mock("@/lib/sync-runner", () => ({
  runSync: (...a: unknown[]) => runSyncMock(...a),
}));

describe("scheduleCatchupSyncIfStale", () => {
  beforeEach(() => {
    syncLogFindFirst.mockReset();
    runSyncMock.mockClear();
  });

  // Achado em 2026-10-30: sem filtrar por status, uma sequência de FAILED recentes mascarava
  // falha prolongada (o registro sempre "parecia recente") e o self-heal nunca disparava.
  it("último SyncLog STOCK é FAILED recente -> dispara catch-up mesmo assim", async () => {
    syncLogFindFirst.mockImplementation(({ where }: { where: { status?: string } }) => {
      // Simula a query real: com filtro de status=SUCCESS, não acha nada (só existe um FAILED).
      if (where.status === "SUCCESS") return Promise.resolve(null);
      return Promise.resolve({ startedAt: new Date() });
    });

    const { scheduleCatchupSyncIfStale } = await import("../self-heal-sync");
    await scheduleCatchupSyncIfStale();

    expect(syncLogFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { source: "STOCK", status: "SUCCESS" } })
    );
    expect(runSyncMock).toHaveBeenCalledTimes(1);
  });

  it("último SyncLog STOCK é SUCCESS recente -> não dispara catch-up", async () => {
    syncLogFindFirst.mockResolvedValue({ startedAt: new Date() });

    const { scheduleCatchupSyncIfStale } = await import("../self-heal-sync");
    await scheduleCatchupSyncIfStale();

    expect(runSyncMock).not.toHaveBeenCalled();
  });

  it("nenhum SyncLog SUCCESS registrado ainda -> dispara catch-up", async () => {
    syncLogFindFirst.mockResolvedValue(null);

    const { scheduleCatchupSyncIfStale } = await import("../self-heal-sync");
    await scheduleCatchupSyncIfStale();

    expect(runSyncMock).toHaveBeenCalledTimes(1);
  });

  it("último SyncLog STOCK SUCCESS é velho (> 5h) -> dispara catch-up", async () => {
    const seisHorasAtras = new Date(Date.now() - 6 * 60 * 60 * 1000);
    syncLogFindFirst.mockResolvedValue({ startedAt: seisHorasAtras });

    const { scheduleCatchupSyncIfStale } = await import("../self-heal-sync");
    await scheduleCatchupSyncIfStale();

    expect(runSyncMock).toHaveBeenCalledTimes(1);
  });

  // "Sincronização interrompida" (processo morreu no meio, nunca gravou SyncLog nenhum pra essa
  // tentativa) — do ponto de vista do self-heal isso é indistinguível de "nenhum SUCCESS recente
  // registrado", porque SyncLog só é gravado no FIM (sucesso ou falha) — uma sync que nunca
  // termina não deixa rastro. Resultado correto é o mesmo: dispara catch-up.
  it("sync anterior nunca terminou (sem SyncLog novo desde um SUCCESS muito antigo) -> dispara catch-up", async () => {
    const doisDiasAtras = new Date(Date.now() - 48 * 60 * 60 * 1000);
    syncLogFindFirst.mockResolvedValue({ startedAt: doisDiasAtras });

    const { scheduleCatchupSyncIfStale } = await import("../self-heal-sync");
    await scheduleCatchupSyncIfStale();

    expect(runSyncMock).toHaveBeenCalledTimes(1);
  });
});

// Nota de cobertura (achado na validação de 2026-10-30): self-heal-sync.ts só consulta SyncLog
// (eventos já TERMINADOS, sucesso ou falha) — ele não tem visibilidade sobre o SyncLock (que é
// quem sabe se uma sync está "RUNNING" agora). A garantia de "não tratar sync em andamento como
// parada" não vem desta função, vem do lock dentro de runSync()/acquireSyncLock() — se o
// self-heal decidir chamar runSync() enquanto uma sync real já está rodando, runSync() mesmo
// recusa e devolve skipped, sem executar doSync() de novo. Esse comportamento é validado
// diretamente em sync-runner.test.ts ("runSync() não executa de novo quando o lock já está
// ativo"), não aqui.
