import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Diagnóstico temporário READ-ONLY (2026-11-25) — pedido do Rodrigo de checar se a sincronização
// rodou nos horários corretos e sem falha desde 2026-11-20. Nenhum INSERT/UPDATE/DELETE. Remover
// depois de respondido.
export const maxDuration = 60;

function autorizado(request: NextRequest): boolean {
  const secret = request.headers.get("x-sync-secret") ?? new URL(request.url).searchParams.get("secret");
  return !!process.env.DIAG_SYNC_SECRET && secret === process.env.DIAG_SYNC_SECRET;
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const desde = new Date("2026-11-20T00:00:00-03:00");

  const logs = await prisma.syncLog.findMany({
    where: { startedAt: { gte: desde } },
    orderBy: { startedAt: "asc" },
    select: { source: true, status: true, recordsSynced: true, message: true, startedAt: true, finishedAt: true },
  });

  const falhas = logs.filter((l) => l.status === "FAILED");

  // Gaps entre sucessos consecutivos de STOCK (sync completo deveria rodar a cada ~10min via
  // sync-frequent + os 5 horários fixos) — qualquer gap > 1h é suspeito.
  const stockSuccess = logs.filter((l) => l.source === "STOCK" && l.status === "SUCCESS");
  const gapsStock: { de: string; para: string; horas: number }[] = [];
  for (let i = 1; i < stockSuccess.length; i++) {
    const h = (stockSuccess[i].startedAt.getTime() - stockSuccess[i - 1].startedAt.getTime()) / 3_600_000;
    if (h > 1) gapsStock.push({ de: stockSuccess[i - 1].startedAt.toISOString(), para: stockSuccess[i].startedAt.toISOString(), horas: Math.round(h * 100) / 100 });
  }

  // Contagem por dia (America/Sao_Paulo) + source + status
  const porDia = new Map<string, Map<string, { success: number; failed: number }>>();
  for (const l of logs) {
    const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(l.startedAt);
    const diaMap = porDia.get(dia) ?? new Map<string, { success: number; failed: number }>();
    const src = diaMap.get(l.source) ?? { success: 0, failed: 0 };
    if (l.status === "SUCCESS") src.success++;
    else src.failed++;
    diaMap.set(l.source, src);
    porDia.set(dia, diaMap);
  }
  const resumoPorDia = [...porDia.entries()].map(([dia, srcMap]) => ({
    dia,
    fontes: [...srcMap.entries()].map(([source, c]) => ({ source, ...c })),
  }));

  // Último sync de cada fonte (frescor atual)
  const ultimoPorFonte: Record<string, { startedAt: string; status: string } | null> = {};
  for (const source of ["SALES", "STOCK", "RETURNS", "PRODUCTION", "GIFTS", "META_ADS", "GA4"]) {
    const ultimo = [...logs].filter((l) => l.source === source).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
    ultimoPorFonte[source] = ultimo ? { startedAt: ultimo.startedAt.toISOString(), status: ultimo.status } : null;
  }

  return NextResponse.json({
    ok: true,
    desde: desde.toISOString(),
    totalLogs: logs.length,
    totalFalhas: falhas.length,
    falhas: falhas.map((f) => ({ source: f.source, startedAt: f.startedAt.toISOString(), message: f.message })),
    gapsStockMaiorQue1h: gapsStock,
    resumoPorDia,
    ultimoPorFonte,
  });
}
