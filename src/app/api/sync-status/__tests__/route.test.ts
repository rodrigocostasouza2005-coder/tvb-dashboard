import { describe, it, expect, vi, beforeEach } from "vitest";

// Missão Black Friday (2026-11, continuação): /api/sync-status já é consumida pelo polling de
// 60s do indicador do cabeçalho em QUALQUER aba aberta (ver comentário na rota) — reforçamos o
// self-heal (scheduleCatchupSyncIfStale) pra rodar também a partir daqui, não só no carregamento
// de dashboard/layout.tsx. Este teste prova 3 coisas: (1) o self-heal é mesmo chamado a cada GET
// autenticado; (2) via after() — não atrasa/não derruba a resposta do polling se o self-heal
// falhar; (3) rota não autenticada nunca dispara self-heal nenhum (seria uma superfície sem
// sessão disparando sync).
const afterMock = vi.fn((fn: () => unknown) => fn());
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => afterMock(fn) };
});

const getSessionUserMock = vi.fn();
vi.mock("@/lib/auth", () => ({ getSessionUser: (...a: unknown[]) => getSessionUserMock(...a) }));

const getLastSyncAtMock = vi.fn().mockResolvedValue({ at: "2026-11-05T10:00:00.000Z", source: "full" });
const getSyncStatusDetalhadoMock = vi.fn().mockResolvedValue({
  dapic: [],
  locks: { sync: false, cancelamentos: false },
  metaAds: { source: "META_ADS", status: null, finishedAt: null, recordsSynced: null, message: null, ultimaAtualizacaoCache: null },
  ga4: { source: "GA4", status: null, finishedAt: null, recordsSynced: null, message: null, ultimaAtualizacaoCache: null },
});
vi.mock("@/lib/sync-runner", () => ({
  getLastSyncAt: (...a: unknown[]) => getLastSyncAtMock(...a),
  getSyncStatusDetalhado: (...a: unknown[]) => getSyncStatusDetalhadoMock(...a),
}));

const scheduleCatchupSyncIfStaleMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/self-heal-sync", () => ({
  scheduleCatchupSyncIfStale: (...a: unknown[]) => scheduleCatchupSyncIfStaleMock(...a),
}));

beforeEach(() => {
  afterMock.mockClear();
  getSessionUserMock.mockReset();
  scheduleCatchupSyncIfStaleMock.mockClear();
});

describe("GET /api/sync-status — reforço do self-heal via after()", () => {
  it("usuário autenticado -> dispara scheduleCatchupSyncIfStale via after() e devolve o status normal", async () => {
    getSessionUserMock.mockResolvedValue({ id: "u1", role: "ADMIN" });

    const { GET } = await import("../route");
    const response = await GET();
    const body = await response.json();

    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(scheduleCatchupSyncIfStaleMock).toHaveBeenCalledTimes(1);
    expect(body).toEqual(expect.objectContaining({ lastSyncAt: "2026-11-05T10:00:00.000Z", source: "full" }));
  });

  it("sem sessão (401) -> NUNCA chama scheduleCatchupSyncIfStale (self-heal não é superfície anônima)", async () => {
    getSessionUserMock.mockResolvedValue(null);

    const { GET } = await import("../route");
    const response = await GET();

    expect(response.status).toBe(401);
    expect(afterMock).not.toHaveBeenCalled();
    expect(scheduleCatchupSyncIfStaleMock).not.toHaveBeenCalled();
  });

  it("3 chamadas 'concorrentes' (3 abas fazendo polling ao mesmo tempo) disparam o self-heal 3x, mas cada chamada é independente — quem de fato evita duplicar a sync é o SyncLock dentro de runSync()/acquireSyncLock (ver Ponto B em sync-runner.test.ts), não esta rota", async () => {
    getSessionUserMock.mockResolvedValue({ id: "u1", role: "ADMIN" });

    const { GET } = await import("../route");
    await Promise.all([GET(), GET(), GET()]);

    expect(scheduleCatchupSyncIfStaleMock).toHaveBeenCalledTimes(3);
  });
});
