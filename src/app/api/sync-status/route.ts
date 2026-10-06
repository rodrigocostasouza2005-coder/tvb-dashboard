import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getLastSyncAt } from "@/lib/sync-runner";

// Etapa 2 do plano de atualização rápida (2026-10-06): endpoint LEVE só pra ler o status —
// nunca dispara sync nenhuma (nem completa, nem a de cancelamento). Consumido pelo polling de
// 60s do indicador "Atualizado: HH:mm" no cabeçalho (ver sync-status-indicator.tsx). Mesma
// autenticação de sessão já usada em outras rotas de API chamadas pelo client logado (ex:
// /api/vendas/produtos-familia) — não é uma rota de cron, não usa CRON_SECRET/EXTERNAL_SYNC_SECRET.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { at, source } = await getLastSyncAt();
  return NextResponse.json({ lastSyncAt: at, source });
}
