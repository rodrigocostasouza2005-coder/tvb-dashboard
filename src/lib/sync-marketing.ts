import { prisma } from "@/lib/prisma";
import { getGastoDiarioConta } from "@/lib/connectors/meta-ads";
import { getSessoesPorDia } from "@/lib/connectors/google-analytics";

// Meta Ads/GA4 só ganhavam um SyncLog quando alguém abria /dashboard/analytics-site (ver
// comentário "Missão Black Friday" em page.tsx) — pedido do Rodrigo em 2026-11-26 pra voltar a
// atualizar pelo menos 5x/dia, igual ao resto do DAPIC, sem depender de visita à página. Chamado
// pelos 5 crons fixos da Vercel (via after(), fora do orçamento de tempo do doSync() principal —
// doSync() já está com margem curta, ver sync-runner.ts). Janela curta (3 dias) só pra
// confirmar que a conexão está viva e os dados recentes vêm — não precisa reproduzir o range
// completo que a página usa, isso é checagem de saúde, não o relatório em si (que continua sendo
// buscado ao vivo quando alguém abre a página).
const JANELA_DIAS = 3;

export async function syncMetaAdsEGa4(agora: Date = new Date()): Promise<void> {
  const until = agora.toISOString().slice(0, 10);
  const since = new Date(agora.getTime() - JANELA_DIAS * 86_400_000).toISOString().slice(0, 10);

  let erroGa4: string | null = null;
  let sessoesPorDia: Awaited<ReturnType<typeof getSessoesPorDia>> = [];
  try {
    sessoesPorDia = await getSessoesPorDia({ startDate: since, endDate: until });
  } catch (e) {
    erroGa4 = e instanceof Error ? e.message : "Erro desconhecido buscando dados do Google Analytics.";
  }

  let erroMetaAds: string | null = null;
  let gastoPorDia = new Map<string, number>();
  try {
    gastoPorDia = await getGastoDiarioConta(since, until);
  } catch (e) {
    erroMetaAds = e instanceof Error ? e.message : "Erro desconhecido buscando investimento do Meta Ads.";
  }

  await Promise.all([
    prisma.syncLog.create({
      data: {
        source: "GA4",
        status: erroGa4 ? "FAILED" : "SUCCESS",
        message: erroGa4,
        recordsSynced: sessoesPorDia.length,
        finishedAt: new Date(),
      },
    }),
    prisma.syncLog.create({
      data: {
        source: "META_ADS",
        status: erroMetaAds ? "FAILED" : "SUCCESS",
        message: erroMetaAds,
        recordsSynced: gastoPorDia.size,
        finishedAt: new Date(),
      },
    }),
  ]).catch(() => {});
}
