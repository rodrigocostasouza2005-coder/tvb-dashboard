import type { NextRequest } from "next/server";
import { handleSyncGet, handleSyncPost } from "@/lib/sync-runner";

// Chamado pelo Vercel Cron (vercel.json) às 8h (horário de Brasília) — o outro horário (17h)
// é /api/sync-evening, um path separado de propósito (ver comentário em sync-runner.ts).
// POST continua disponível pra chamar manualmente (com x-cron-secret), útil pra testar.
export const maxDuration = 800;

export async function GET(request: NextRequest) {
  return handleSyncGet(request);
}

export async function POST(request: NextRequest) {
  return handleSyncPost(request);
}
