import type { NextRequest } from "next/server";
import { handleSyncGet, handleSyncPost } from "@/lib/sync-runner";

// Chamado pelo Vercel Cron (vercel.json) às 8h (horário de Brasília) — o outro horário (17h)
// é /api/sync-evening, um path separado de propósito (ver comentário em sync-runner.ts).
// POST continua disponível pra chamar manualmente (com x-cron-secret), útil pra testar.
export const maxDuration = 300;

// checkDuplicates: true só aqui (sync das 8h) — pedido do Rodrigo em 2026-09-28, roda 1x/dia (não
// nas outras 2 syncs do dia) pra não repetir a mesma checagem à toa. Ver checkForDuplicateSales
// e buildAlertaEstoqueParadoSemanal em sync-runner.ts.
const SYNC_OPTIONS = { checkDuplicates: true };

export async function GET(request: NextRequest) {
  return handleSyncGet(request, SYNC_OPTIONS);
}

export async function POST(request: NextRequest) {
  return handleSyncPost(request, SYNC_OPTIONS);
}
