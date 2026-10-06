import type { NextRequest } from "next/server";
import { handleSyncGet, handleSyncPost } from "@/lib/sync-runner";

// Chamado pelo Vercel Cron às 18h30 (horário de Brasília) — 3º horário de segurança. Silenciosa
// (não manda "✅ atualizado" no bot, igual sync-midnight/sync-noon) — pedido do Rodrigo em
// 2026-10-06. Erro continua avisando normalmente.
export const maxDuration = 300;

const SYNC_OPTIONS = { silent: true };

export async function GET(request: NextRequest) {
  return handleSyncGet(request, SYNC_OPTIONS);
}

export async function POST(request: NextRequest) {
  return handleSyncPost(request, SYNC_OPTIONS);
}
