import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Diagnóstico temporário READ-ONLY (2026-11-26) — missão de recuperação do cron externo.
// Confirma estado real do lock "sync" e dos últimos SyncLog, sem precisar adivinhar via
// tentativa/erro. Remover depois de respondido.
export const maxDuration = 30;

function autorizado(request: NextRequest): boolean {
  const secret = request.headers.get("x-sync-secret") ?? new URL(request.url).searchParams.get("secret");
  return !!process.env.DIAG_LOCK_SECRET && secret === process.env.DIAG_LOCK_SECRET;
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const locks = await prisma.syncLock.findMany();
  const ultimosLogs = await prisma.syncLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 15,
    select: { source: true, status: true, recordsSynced: true, message: true, startedAt: true, finishedAt: true },
  });

  return NextResponse.json({
    agora: new Date().toISOString(),
    locks: locks.map((l) => ({ id: l.id, startedAt: l.startedAt.toISOString(), finishedAt: l.finishedAt?.toISOString() ?? null })),
    ultimosLogs: ultimosLogs.map((l) => ({
      source: l.source,
      status: l.status,
      recordsSynced: l.recordsSynced,
      message: l.message,
      startedAt: l.startedAt.toISOString(),
      finishedAt: l.finishedAt?.toISOString() ?? null,
    })),
  });
}
