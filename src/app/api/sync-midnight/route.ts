import type { NextRequest } from "next/server";
import { handleSyncGet, handleSyncPost } from "@/lib/sync-runner";

// Chamado pelo Vercel Cron às 0h (horário de Brasília) — sync extra de segurança, silenciosa
// (não manda "✅ atualizado" no bot) e tenta de novo se falhar, dentro do tempo que sobrar da
// execução — pedido do Rodrigo em 2026-08-24. Erro (se esgotar as tentativas) avisa só ele.
export const maxDuration = 800;

const SYNC_OPTIONS = { silent: true, retryBudgetMs: 240_000 };

export async function GET(request: NextRequest) {
  return handleSyncGet(request, SYNC_OPTIONS);
}

export async function POST(request: NextRequest) {
  return handleSyncPost(request, SYNC_OPTIONS);
}
