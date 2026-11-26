import { after } from "next/server";
import type { NextRequest } from "next/server";
import { handleSyncGet, handleSyncPost } from "@/lib/sync-runner";
import { syncMetaAdsEGa4 } from "@/lib/sync-marketing";

// Chamado pelo Vercel Cron às 17h (horário de Brasília). Path separado de /api/sync de propósito
// — ver comentário em src/lib/sync-runner.ts.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Meta Ads/GA4 (pedido do Rodrigo 2026-11-26: voltar a atualizar pelo menos 5x/dia) — after()
  // pra não competir pelo orçamento de tempo do doSync() principal.
  after(() => syncMetaAdsEGa4().catch(() => {}));
  return handleSyncGet(request);
}

export async function POST(request: NextRequest) {
  after(() => syncMetaAdsEGa4().catch(() => {}));
  return handleSyncPost(request);
}
