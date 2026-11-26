import { after } from "next/server";
import type { NextRequest } from "next/server";
import { handleSyncGet, handleSyncPost } from "@/lib/sync-runner";
import { syncMetaAdsEGa4 } from "@/lib/sync-marketing";

// Chamado pelo Vercel Cron às 12h (horário de Brasília) — sync extra de segurança, silenciosa
// (não manda "✅ atualizado" no bot) e tenta de novo se falhar, dentro do tempo que sobrar da
// execução — pedido do Rodrigo em 2026-08-24. Erro (se esgotar as tentativas) avisa só ele.
export const maxDuration = 300;

const SYNC_OPTIONS = { silent: true, retryBudgetMs: 240_000 };

export async function GET(request: NextRequest) {
  // Meta Ads/GA4 (pedido do Rodrigo 2026-11-26: voltar a atualizar pelo menos 5x/dia) — after()
  // pra não competir pelo orçamento de tempo do doSync() principal.
  after(() => syncMetaAdsEGa4().catch(() => {}));
  return handleSyncGet(request, SYNC_OPTIONS);
}

export async function POST(request: NextRequest) {
  after(() => syncMetaAdsEGa4().catch(() => {}));
  return handleSyncPost(request, SYNC_OPTIONS);
}
