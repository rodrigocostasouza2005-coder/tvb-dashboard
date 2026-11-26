import { describe, it, expect, vi, beforeEach } from "vitest";

const syncLogCreate = vi.fn().mockResolvedValue({});
vi.mock("@/lib/prisma", () => ({ prisma: { syncLog: { create: (...a: unknown[]) => syncLogCreate(...a) } } }));

const getGastoDiarioConta = vi.fn();
vi.mock("@/lib/connectors/meta-ads", () => ({ getGastoDiarioConta: (...a: unknown[]) => getGastoDiarioConta(...a) }));

const getSessoesPorDia = vi.fn();
vi.mock("@/lib/connectors/google-analytics", () => ({ getSessoesPorDia: (...a: unknown[]) => getSessoesPorDia(...a) }));

// Meta Ads/GA4 só ganhavam SyncLog quando alguém abria /dashboard/analytics-site — pedido do
// Rodrigo em 2026-11-26 pra voltar a atualizar pelo menos 5x/dia (chamado pelos 5 crons fixos da
// Vercel via after(), ver src/app/api/sync*/route.ts).
describe("syncMetaAdsEGa4", () => {
  beforeEach(() => {
    syncLogCreate.mockClear();
    getGastoDiarioConta.mockReset();
    getSessoesPorDia.mockReset();
  });

  it("GA4 e Meta Ads OK -> grava 2 SyncLog SUCCESS", async () => {
    getSessoesPorDia.mockResolvedValue([{ data: "2026-11-26", sessoes: 10 }]);
    getGastoDiarioConta.mockResolvedValue(new Map([["2026-11-26", 50]]));

    const { syncMetaAdsEGa4 } = await import("../sync-marketing");
    await syncMetaAdsEGa4(new Date("2026-11-26T12:00:00Z"));

    expect(syncLogCreate).toHaveBeenCalledTimes(2);
    const fontes = syncLogCreate.mock.calls.map((c) => (c[0] as { data: { source: string } }).data.source);
    expect(fontes.sort()).toEqual(["GA4", "META_ADS"]);
    for (const call of syncLogCreate.mock.calls) {
      expect((call[0] as { data: { status: string } }).data.status).toBe("SUCCESS");
    }
  });

  it("GA4 falha, Meta Ads OK -> GA4 vira FAILED com a mensagem real, Meta Ads continua SUCCESS", async () => {
    getSessoesPorDia.mockRejectedValue(new Error("GA4: credencial inválida"));
    getGastoDiarioConta.mockResolvedValue(new Map());

    const { syncMetaAdsEGa4 } = await import("../sync-marketing");
    await syncMetaAdsEGa4(new Date("2026-11-26T12:00:00Z"));

    const ga4Call = syncLogCreate.mock.calls.find((c) => (c[0] as { data: { source: string } }).data.source === "GA4")!;
    const metaCall = syncLogCreate.mock.calls.find((c) => (c[0] as { data: { source: string } }).data.source === "META_ADS")!;
    expect((ga4Call[0] as { data: { status: string; message: string } }).data.status).toBe("FAILED");
    expect((ga4Call[0] as { data: { status: string; message: string } }).data.message).toBe("GA4: credencial inválida");
    expect((metaCall[0] as { data: { status: string } }).data.status).toBe("SUCCESS");
  });

  it("Meta Ads falha (token vencido), GA4 OK -> META_ADS vira FAILED, GA4 continua SUCCESS", async () => {
    getSessoesPorDia.mockResolvedValue([]);
    getGastoDiarioConta.mockRejectedValue(new Error("Meta Ads API: token vencido"));

    const { syncMetaAdsEGa4 } = await import("../sync-marketing");
    await syncMetaAdsEGa4(new Date("2026-11-26T12:00:00Z"));

    const metaCall = syncLogCreate.mock.calls.find((c) => (c[0] as { data: { source: string } }).data.source === "META_ADS")!;
    expect((metaCall[0] as { data: { status: string; message: string } }).data.status).toBe("FAILED");
    expect((metaCall[0] as { data: { status: string; message: string } }).data.message).toBe("Meta Ads API: token vencido");
  });

  it("nunca propaga erro mesmo se a escrita do SyncLog falhar", async () => {
    getSessoesPorDia.mockResolvedValue([]);
    getGastoDiarioConta.mockResolvedValue(new Map());
    syncLogCreate.mockRejectedValue(new Error("Neon: conexão perdida"));

    const { syncMetaAdsEGa4 } = await import("../sync-marketing");
    await expect(syncMetaAdsEGa4(new Date())).resolves.toBeUndefined();
  });
});
