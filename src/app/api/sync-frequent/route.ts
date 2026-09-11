import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runSync } from "@/lib/sync-runner";

// Chamado por um agendador EXTERNO (cron-job.org, não Vercel Cron — o plano Hobby não suporta
// intervalo de minutos) a cada 10min — pedido do Rodrigo em 2026-09-11 pra manter o banco mais
// fresco ao longo do dia, sem precisar do Vercel Pro. Silenciosa (não manda "✅ atualizado" no
// Telegram — isso ainda só acontece nos 5 horários fixos de /api/sync, /api/sync-evening etc.,
// senão o time recebia esse aviso 144x/dia). Erro sempre avisa, só pro admin, igual as outras.
// Retry budget curto: com trigger a cada 10min não compensa insistir muito, a próxima chamada já
// tenta de novo sozinha em breve.
//
// Segredo PRÓPRIO (EXTERNAL_SYNC_SECRET), não o CRON_SECRET — esse último está marcado
// "Sensitive" na Vercel (nem o Rodrigo consegue ver o valor de novo pra colar no cron-job.org),
// então essa rota usa uma credencial nova e separada, pensada pra ficar num serviço de terceiro.
export const maxDuration = 300;

const SYNC_OPTIONS = { silent: true, retryBudgetMs: 60_000 };

function autorizado(request: NextRequest): boolean {
  const secret = request.headers.get("x-sync-secret") ?? new URL(request.url).searchParams.get("secret");
  return !!process.env.EXTERNAL_SYNC_SECRET && secret === process.env.EXTERNAL_SYNC_SECRET;
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return runSync(SYNC_OPTIONS);
}

export async function POST(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return runSync(SYNC_OPTIONS);
}
