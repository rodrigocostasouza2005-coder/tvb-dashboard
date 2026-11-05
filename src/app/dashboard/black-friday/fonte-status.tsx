import type { SyncStatusDetalhado } from "@/lib/sync-runner";

// Item 6 da missão: nunca mostrar número sem indicar quando a fonte dele foi atualizada por
// último. Server component simples (sem polling) — o indicador global do cabeçalho
// (sync-status-indicator.tsx) já cobre "está fresco agora"; este bloco é "de onde vem cada
// pedaço desta página específica", por fonte, igual getSyncStatusDetalhado já expõe.
function formatDateTime(iso: string | null): string {
  if (!iso) return "sem registro";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const LABEL_DAPIC: Record<string, string> = {
  SALES: "Vendas (DAPIC)",
  STOCK: "Estoque (DAPIC)",
  RETURNS: "Devoluções (DAPIC)",
  PRODUCTION: "Produção (DAPIC)",
  GIFTS: "Brindes (DAPIC)",
};

export function FonteStatus({ status }: { status: SyncStatusDetalhado }) {
  // Só as fontes que esta página de fato usa — vendas/devolução (canais e produtos) e Meta Ads
  // (campanhas, investimento e CAC). Estoque/produção/brindes não aparecem aqui nem em outra
  // parte do Radar via Meta Ads — fora do escopo desta tela.
  const dapicRelevante = status.dapic.filter((d) => d.source === "SALES" || d.source === "RETURNS");

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
      {dapicRelevante.map((d) => (
        <span key={d.source} title={d.message ?? undefined}>
          {LABEL_DAPIC[d.source] ?? d.source}:{" "}
          <span className={d.status === "FAILED" ? "text-[var(--status-critical)]" : "text-[var(--text-secondary)]"}>
            {d.status === "FAILED" ? "falhou" : formatDateTime(d.finishedAt)}
          </span>
        </span>
      ))}
      <span title={status.metaAds.message ?? undefined}>
        Meta Ads:{" "}
        <span className={status.metaAds.status === "FAILED" ? "text-[var(--status-critical)]" : "text-[var(--text-secondary)]"}>
          {status.metaAds.status === "FAILED" ? "falhou" : formatDateTime(status.metaAds.finishedAt ?? status.metaAds.ultimaAtualizacaoCache)}
        </span>
      </span>
      <span title={status.ga4.message ?? undefined}>
        GA4:{" "}
        <span className={status.ga4.status === "FAILED" ? "text-[var(--status-critical)]" : "text-[var(--text-secondary)]"}>
          {status.ga4.status === "FAILED" ? "falhou" : formatDateTime(status.ga4.finishedAt ?? status.ga4.ultimaAtualizacaoCache)}
        </span>
      </span>
    </div>
  );
}
