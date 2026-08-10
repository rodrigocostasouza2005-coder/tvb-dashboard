import { prisma } from "@/lib/prisma";
import { runSync } from "@/lib/sync-runner";

// Rede de segurança contra o cron da Vercel falhar de vez em quando (ex: deploy caindo bem em
// cima do minuto agendado — aconteceu em 2026-08-10, os 2 crons do dia não dispararam). Se
// alguém abrir o dashboard e o último sync tiver mais de STALE_HOURS, dispara uma sync na hora,
// em background (via after(), não atrasa a página) — sem depender só da Vercel Cron rodar certo.
const STALE_HOURS = 5;

export async function scheduleCatchupSyncIfStale() {
  const last = await prisma.syncLog.findFirst({
    where: { source: "STOCK" },
    orderBy: { startedAt: "desc" },
  });
  const staleMs = STALE_HOURS * 60 * 60 * 1000;
  if (last && Date.now() - last.startedAt.getTime() < staleMs) return;

  await runSync().catch(() => {
    // runSync já loga o erro e avisa no Telegram sozinho — aqui só evita derrubar o after().
  });
}
