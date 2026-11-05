import { NextResponse, after } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getLastSyncAt, getSyncStatusDetalhado } from "@/lib/sync-runner";
import { scheduleCatchupSyncIfStale } from "@/lib/self-heal-sync";

// Etapa 2 do plano de atualização rápida (2026-10-06): endpoint LEVE só pra ler o status —
// nunca dispara sync nenhuma (nem completa, nem a de cancelamento). Consumido pelo polling de
// 60s do indicador "Atualizado: HH:mm" no cabeçalho (ver sync-status-indicator.tsx). Mesma
// autenticação de sessão já usada em outras rotas de API chamadas pelo client logado (ex:
// /api/vendas/produtos-familia) — não é uma rota de cron, não usa CRON_SECRET/EXTERNAL_SYNC_SECRET.
//
// `detalhado` (missão Black Friday, 2026-11) é aditivo — lastSyncAt/source continuam exatamente
// como antes (sync-status-indicator.tsx não precisa mudar nada). Por fonte (DAPIC vendas/estoque/
// devoluções/produção/brindes + Meta Ads/GA4, ver getSyncStatusDetalhado) — pra uma futura
// tela/alerta de "dado desatualizado por fonte" sem precisar de nova query solta.
//
// Missão Black Friday (2026-11, continuação, reforço do self-heal): até aqui
// scheduleCatchupSyncIfStale() só disparava no carregamento de dashboard/layout.tsx — rede de
// segurança real, mas que NUNCA roda se ninguém abrir uma página nova (ex: dashboard aberto numa
// aba só, fora do horário comercial, sem ninguém navegando entre abas). Esta rota já é consumida
// pelo polling de 60s do indicador do cabeçalho em QUALQUER aba aberta — chamar o mesmo self-heal
// aqui dá uma segunda rede que não depende de alguém abrir uma página específica, só de deixar o
// dashboard aberto. `after()` igual ao layout (não atrasa a resposta do polling). Seguro contra
// múltiplas abas/usuários chamando ao mesmo tempo: scheduleCatchupSyncIfStale só decide SE está
// stale (leitura); quem de fato serializa é acquireSyncLock() dentro de runSync() (mesmo lock que
// já protege o cron externo de 10min e o Force Sync manual) — chamadas concorrentes que acharem
// stale ao mesmo tempo disputam o mesmo lock, só a 1ª executa de verdade, as outras voltam
// {skipped: true} na hora (ver Ponto B em sync-runner.test.ts). Não roda a cada request: só
// quando a última sync SUCCESS está mais velha que STALE_HOURS (self-heal-sync.ts).
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  after(() => scheduleCatchupSyncIfStale());

  const [{ at, source }, detalhado] = await Promise.all([getLastSyncAt(), getSyncStatusDetalhado()]);
  return NextResponse.json({ lastSyncAt: at, source, detalhado });
}
