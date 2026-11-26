import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Diagnóstico temporário READ-ONLY (2026-11-26) — confirmar se o sync voltou a atualizar
// sozinho via Vercel+self-heal após abandono do cron-job.org. Remover depois de respondido.
export const maxDuration = 30;

function autorizado(request: NextRequest): boolean {
  const secret = request.headers.get("x-sync-secret") ?? new URL(request.url).searchParams.get("secret");
  return !!process.env.DIAG_STATUS_SECRET && secret === process.env.DIAG_STATUS_SECRET;
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ultimosLogs = await prisma.syncLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
    select: { source: true, status: true, recordsSynced: true, startedAt: true, finishedAt: true },
  });

  const locks = await prisma.syncLock.findMany();

  return NextResponse.json({
    agora: new Date().toISOString(),
    ultimosLogs: ultimosLogs.map((l) => ({
      source: l.source,
      status: l.status,
      recordsSynced: l.recordsSynced,
      startedAt: l.startedAt.toISOString(),
      finishedAt: l.finishedAt?.toISOString() ?? null,
    })),
    locks: locks.map((l) => ({ id: l.id, startedAt: l.startedAt.toISOString(), finishedAt: l.finishedAt?.toISOString() ?? null })),
  });
}
