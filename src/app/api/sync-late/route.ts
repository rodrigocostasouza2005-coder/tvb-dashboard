import { after } from "next/server";
import type { NextRequest } from "next/server";
import { handleSyncGet, handleSyncPost } from "@/lib/sync-runner";
import { syncMetaAdsEGa4 } from "@/lib/sync-marketing";

// Chamado pelo Vercel Cron às 18h30 (horário de Brasília) — 3º horário de segurança. Silenciosa
// (não manda "✅ atualizado" no bot, igual sync-midnight/sync-noon) — pedido do Rodrigo em
// 2026-10-06. Erro continua avisando normalmente.
export const maxDuration = 300;

const SYNC_OPTIONS = { silent: true };

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
