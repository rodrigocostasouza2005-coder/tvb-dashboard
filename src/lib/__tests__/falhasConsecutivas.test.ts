import { describe, it, expect, vi, beforeEach } from "vitest";

// Auditoria pós-incidente 2026-11-25 (Fase 5, pedido explícito): "erro" sozinho não distingue 1
// falha isolada (comum, DAPIC instável) de uma sequência real de falhas consecutivas. Testa a
// contagem exposta em StatusFonteDapic/StatusFonteExterna.falhasConsecutivas via
// getSyncStatusDetalhado.

const syncLogFindFirst = vi.fn();
const syncLogCount = vi.fn();
const syncLockFindUnique = vi.fn().mockResolvedValue(null);
const priceCatalogCacheFindFirst = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    syncLog: {
      findFirst: (...a: unknown[]) => syncLogFindFirst(...a),
      count: (...a: unknown[]) => syncLogCount(...a),
    },
    syncLock: { findUnique: (...a: unknown[]) => syncLockFindUnique(...a) },
    priceCatalogCache: { findFirst: (...a: unknown[]) => priceCatalogCacheFindFirst(...a) },
  },
}));

beforeEach(() => {
  syncLogFindFirst.mockReset().mockResolvedValue(null);
  syncLogCount.mockReset().mockResolvedValue(0);
  syncLockFindUnique.mockReset().mockResolvedValue(null);
});

describe("getSyncStatusDetalhado — falhasConsecutivas por fonte", () => {
  it("0 quando a última tentativa já foi SUCCESS", async () => {
    syncLogFindFirst.mockImplementation(async ({ where }: { where: { status?: string } }) => {
      if (where.status === "SUCCESS") return { finishedAt: new Date("2026-11-25T12:00:00Z") };
      return { status: "SUCCESS", startedAt: new Date(), finishedAt: new Date("2026-11-25T12:00:00Z"), recordsSynced: 10, message: null };
    });
    syncLogCount.mockResolvedValue(0);

    const { getSyncStatusDetalhado } = await import("../sync-runner");
    const r = await getSyncStatusDetalhado();
    expect(r.dapic.find((d) => d.source === "STOCK")?.falhasConsecutivas).toBe(0);
  });

  it("conta só as FAILED mais recentes que a última SUCCESS, nunca as de antes dela", async () => {
    // Cenário: SUCCESS às 10h, depois 3 FAILED em sequência (11h,12h,13h) — a última tentativa é
    // FAILED (13h), então falhasConsecutivas deve ser 3, contando só depois do SUCCESS das 10h.
    syncLogFindFirst.mockImplementation(async ({ where }: { where: { status?: string } }) => {
      if (where.status === "SUCCESS") return { finishedAt: new Date("2026-11-25T10:00:00Z") };
      return { status: "FAILED", startedAt: new Date(), finishedAt: new Date("2026-11-25T13:00:00Z"), recordsSynced: 0, message: "erro X" };
    });
    syncLogCount.mockImplementation(async ({ where }: { where: { finishedAt?: { gt?: Date } } }) => {
      // Simula: só 3 linhas FAILED com finishedAt > 10h (11h,12h,13h) existem no "banco" simulado.
      expect(where.finishedAt?.gt).toEqual(new Date("2026-11-25T10:00:00Z"));
      return 3;
    });

    const { getSyncStatusDetalhado } = await import("../sync-runner");
    const r = await getSyncStatusDetalhado();
    const stock = r.dapic.find((d) => d.source === "STOCK");
    expect(stock?.falhasConsecutivas).toBe(3);
    expect(stock?.statusVisual).toBe("erro");
  });

  it("nunca houve SUCCESS: conta todas as FAILED já registradas (sem filtro de data)", async () => {
    syncLogFindFirst.mockImplementation(async ({ where }: { where: { status?: string } }) => {
      if (where.status === "SUCCESS") return null;
      return { status: "FAILED", startedAt: new Date(), finishedAt: new Date(), recordsSynced: 0, message: "erro" };
    });
    syncLogCount.mockImplementation(async ({ where }: { where: { finishedAt?: unknown } }) => {
      expect(where.finishedAt).toEqual({ not: null });
      return 7;
    });

    const { getSyncStatusDetalhado } = await import("../sync-runner");
    const r = await getSyncStatusDetalhado();
    expect(r.dapic.find((d) => d.source === "STOCK")?.falhasConsecutivas).toBe(7);
  });
});
