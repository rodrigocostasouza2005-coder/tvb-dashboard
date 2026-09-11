import type { NextRequest } from "next/server";
import { handleSyncGet, handleSyncPost } from "@/lib/sync-runner";

// Chamado por um agendador EXTERNO (cron-job.org, não Vercel Cron — o plano Hobby não suporta
// intervalo de minutos) a cada 10min — pedido do Rodrigo em 2026-09-11 pra manter o banco mais
// fresco ao longo do dia, sem precisar do Vercel Pro. Silenciosa (não manda "✅ atualizado" no
// Telegram — isso ainda só acontece nos 5 horários fixos de /api/sync, /api/sync-evening etc.,
// senão o time recebia esse aviso 144x/dia). Erro sempre avisa, só pro admin, igual as outras.
// Retry budget curto: com trigger a cada 10min não compensa insistir muito, a próxima chamada já
// tenta de novo sozinha em breve.
export const maxDuration = 300;

const SYNC_OPTIONS = { silent: true, retryBudgetMs: 60_000 };

export async function GET(request: NextRequest) {
  return handleSyncGet(request, SYNC_OPTIONS);
}

export async function POST(request: NextRequest) {
  return handleSyncPost(request, SYNC_OPTIONS);
}
