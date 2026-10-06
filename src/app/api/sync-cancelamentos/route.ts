import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runCancelamentosRapidos } from "@/lib/sync-runner";

// Etapa 1 do plano de atualização rápida do Radar (2026-10-06): só a reconciliação de
// cancelamento (reconciliarCancelamentosVendas/Faturas), nunca estoque/vendas completas/
// produção/brindes — pensada pra rodar bem mais frequente (2-5 min) que o sync completo
// (/api/sync-frequent, 10 min), sem herdar o custo dele. Mesmo padrão de segredo e agendador
// externo do sync-frequent (cron-job.org — Vercel Hobby não tem cron de minuto), reaproveitando
// o MESMO EXTERNAL_SYNC_SECRET (não inventa credencial nova).
export const maxDuration = 60;

function autorizado(request: NextRequest): boolean {
  const secret = request.headers.get("x-sync-secret") ?? new URL(request.url).searchParams.get("secret");
  return !!process.env.EXTERNAL_SYNC_SECRET && secret === process.env.EXTERNAL_SYNC_SECRET;
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return runCancelamentosRapidos();
}

export async function POST(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return runCancelamentosRapidos();
}
