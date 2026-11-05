import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getLastSyncAt, getSyncStatusDetalhado } from "@/lib/sync-runner";

// Etapa 2 do plano de atualização rápida (2026-10-06): endpoint LEVE só pra ler o status —
// nunca dispara sync nenhuma (nem completa, nem a de cancelamento). Consumido pelo polling de
// 60s do indicador "Atualizado: HH:mm" no cabeçalho (ver sync-status-indicator.tsx). Mesma
// autenticação de sessão já usada em outras rotas de API chamadas pelo client logado (ex:
// /api/vendas/produtos-familia) — não é uma rota de cron, não usa CRON_SECRET/EXTERNAL_SYNC_SECRET.
//
// `detalhado` (missão Black Friday, 2026-11) é aditivo — lastSyncAt/source continuam exatamente
// como antes (sync-status-indicator.tsx não precisa mudar nada). Por fonte (DAPIC vendas/estoque/
// devoluções/produção/brindes + o que existe hoje pra Meta Ads/GA4, ver getSyncStatusDetalhado) —
// pra uma futura tela/alerta de "dado desatualizado por fonte" sem precisar de nova query solta.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [{ at, source }, detalhado] = await Promise.all([getLastSyncAt(), getSyncStatusDetalhado()]);
  return NextResponse.json({ lastSyncAt: at, source, detalhado });
}
