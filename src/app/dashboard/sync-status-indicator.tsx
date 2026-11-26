"use client";

import { useEffect, useRef, useState } from "react";
import type { SyncStatusDetalhado, StatusVisual } from "@/lib/sync-runner";

function formatHora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// "atualizado há Xmin/Xh/Xd" — idade real calculada contra AGORA (parâmetro `agora`, não
// Date.now() direto, pra ficar determinístico em teste e pra reaproveitar o mesmo "agora" em toda
// a lista de fontes num único render). Resgate da feature "status detalhado no header"
// (worktree órfão agent-af55e6056fe53e292): nunca mostrar só o timestamp cru no dropdown.
export function formatIdade(iso: string | null, agora: Date): string {
  if (!iso) return "sem registro";
  const diffMs = agora.getTime() - new Date(iso).getTime();
  if (diffMs < 0) return "agora";
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

export function formatDuracao(ms: number | null): string {
  if (ms === null || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const min = Math.floor(s / 60);
  const resto = s % 60;
  return resto > 0 ? `${min}min ${resto}s` : `${min}min`;
}

const LABEL_FONTE: Record<string, string> = {
  SALES: "Vendas",
  STOCK: "Estoque",
  RETURNS: "Devoluções",
  PRODUCTION: "Produção",
  GIFTS: "Brindes",
  META_ADS: "Meta Ads",
  GA4: "Google Analytics",
};

const STATUS_VISUAL_INFO: Record<StatusVisual, { texto: string; cor: string }> = {
  atualizado: { texto: "Atualizado", cor: "var(--status-good)" },
  executando: { texto: "Sincronizando…", cor: "var(--text-secondary)" },
  atrasado: { texto: "Atrasado", cor: "var(--status-warning)" },
  erro: { texto: "Erro", cor: "var(--status-critical)" },
  sem_dados: { texto: "Sem dados", cor: "var(--text-muted)" },
};

export type FonteLinha = {
  source: string;
  statusVisual: StatusVisual;
  ultimaAtualizacaoReal: string | null;
  duracaoMs: number | null;
  recordsSynced: number | null;
  message: string | null;
  falhasConsecutivas: number;
};

export function achatarFontes(detalhado: SyncStatusDetalhado | null): FonteLinha[] {
  if (!detalhado) return [];
  return [
    ...detalhado.dapic.map((d) => ({
      source: d.source,
      statusVisual: d.statusVisual,
      ultimaAtualizacaoReal: d.ultimaAtualizacaoReal,
      duracaoMs: d.duracaoMs,
      recordsSynced: d.recordsSynced,
      message: d.message,
      falhasConsecutivas: d.falhasConsecutivas,
    })),
    {
      source: detalhado.metaAds.source,
      statusVisual: detalhado.metaAds.statusVisual,
      ultimaAtualizacaoReal: detalhado.metaAds.ultimaAtualizacaoReal,
      duracaoMs: detalhado.metaAds.duracaoMs,
      recordsSynced: detalhado.metaAds.recordsSynced,
      message: detalhado.metaAds.message,
      falhasConsecutivas: detalhado.metaAds.falhasConsecutivas,
    },
    {
      source: detalhado.ga4.source,
      statusVisual: detalhado.ga4.statusVisual,
      ultimaAtualizacaoReal: detalhado.ga4.ultimaAtualizacaoReal,
      duracaoMs: detalhado.ga4.duracaoMs,
      recordsSynced: detalhado.ga4.recordsSynced,
      message: detalhado.ga4.message,
      falhasConsecutivas: detalhado.ga4.falhasConsecutivas,
    },
  ];
}

// Pior status entre as fontes, só pra decidir a cor do dot do badge compacto do cabeçalho — a
// ordem de prioridade é a mesma de calcularStatusVisualDapic (sync-runner.ts): executando > erro >
// atrasado > atualizado > sem_dados (sem_dados nunca "pior" que atualizado pro badge: Meta
// Ads/GA4 sem registro ainda, por exemplo, não deveria pintar o indicador inteiro de alerta).
const PRIORIDADE: StatusVisual[] = ["executando", "erro", "atrasado", "atualizado", "sem_dados"];
export function piorStatus(fontes: FonteLinha[]): StatusVisual {
  for (const candidato of PRIORIDADE) {
    if (fontes.some((f) => f.statusVisual === candidato)) return candidato;
  }
  return "sem_dados";
}

// "Atualizado: HH:mm" no cabeçalho global — pedido do Rodrigo em 2026-10-06 pra saber se o
// Radar está com dado fresco sem precisar dar F5. Só atualiza o RELÓGIO (estado local deste
// componente) quando o polling detecta um timestamp mais novo que o conhecido — nunca chama
// router.refresh() nem recarrega dado de página nenhuma, de propósito (evita reintroduzir o
// problema de tela branca que já corrigimos nos filtros). Pausa o poll quando a aba não está
// visível (Page Visibility API) e já checa de novo assim que volta a ficar visível, em vez de
// esperar até 60s depois de voltar.
// Intervalo normal de poll (igual antes). Quando uma sync está em andamento (ver `syncing`
// abaixo), encurta pra POLL_MS_SYNCING — pedido do Rodrigo (2026-11-10) pra ver "Atualizando..."
// enquanto a sync roda, sem esperar até 60s depois dela terminar pra voltar a mostrar o horário.
const POLL_MS_NORMAL = 60_000;
const POLL_MS_SYNCING = 10_000;

// Resgate da feature "status detalhado no header" (worktree órfão agent-af55e6056fe53e292,
// auditoria 2026-11-14 — ficou parada >60 commits sem nunca abrir PR). O badge compacto continua
// exatamente como já estava ("Atualizando…"/spinner enquanto `syncing`, "Atualizado: HH:mm"
// quando não) — essa parte já tinha sido resolvida por outra PR e não foi tocada aqui. O que esta
// tarefa acrescenta: o badge agora é clicável e abre um dropdown com o detalhe por fonte (DAPIC +
// Meta Ads/GA4) — status visual, idade real ("há Xmin", recalculada a cada 30s via o tick
// `agora`, nunca só o timestamp cru), duração da última execução e mensagem de erro quando houver.
// Reaproveita `detalhado` do MESMO fetch de /api/sync-status que já alimentava `syncing` — nenhuma
// rota nova, nenhum fetch extra.
export function SyncStatusIndicator({
  initialLastSyncAt,
  initialDetalhado,
}: {
  initialLastSyncAt: string | null;
  initialDetalhado?: SyncStatusDetalhado | null;
}) {
  const [lastSyncAt, setLastSyncAt] = useState(initialLastSyncAt);
  const [syncing, setSyncing] = useState(false);
  const lastSyncAtRef = useRef(initialLastSyncAt);
  const [detalhado, setDetalhado] = useState<SyncStatusDetalhado | null>(initialDetalhado ?? null);
  const [agora, setAgora] = useState(() => new Date());
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    // setInterval atual — recriado quando o intervalo precisa mudar (passou a sincronizar/parou
    // de sincronizar), nunca comparado por identidade de função (ver restart() abaixo).
    let interval: ReturnType<typeof setInterval> | null = null;
    let tick: ReturnType<typeof setInterval> | null = null;
    let currentMs = POLL_MS_NORMAL;

    async function checarStatus() {
      try {
        const res = await fetch("/api/sync-status", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data: { lastSyncAt: string | null; detalhado?: SyncStatusDetalhado } = await res.json();
        if (cancelled) return;
        if (data.lastSyncAt && data.lastSyncAt !== lastSyncAtRef.current) {
          lastSyncAtRef.current = data.lastSyncAt;
          setLastSyncAt(data.lastSyncAt);
        }
        // Detalhado é sempre aplicado (não só quando lastSyncAt muda): "executando"/"atrasado"
        // podem mudar sem que lastSyncAt mude (ex: uma sync começou a travar — ainda não
        // terminou, então lastSyncAt continua igual, mas locks.sync virou true).
        if (data.detalhado) setDetalhado(data.detalhado);
        // "sync" (cron completo) OU "cancelamentos" (reconciliação rápida) — qualquer um dos dois
        // em andamento já conta como "atualizando" pro usuário, não precisa distinguir qual.
        const emAndamento = !!(data.detalhado?.locks?.sync || data.detalhado?.locks?.cancelamentos);
        setSyncing((prev) => (prev !== emAndamento ? emAndamento : prev));
        restart(emAndamento ? POLL_MS_SYNCING : POLL_MS_NORMAL);
      } catch {
        // Falha de rede/polling não deve derrubar o indicador — mantém o último estado conhecido.
      }
    }

    function restart(ms: number) {
      if (interval !== null && ms === currentMs) return;
      if (interval !== null) clearInterval(interval);
      currentMs = ms;
      interval = setInterval(checarStatus, ms);
    }

    function start() {
      if (interval === null) {
        checarStatus();
        interval = setInterval(checarStatus, currentMs);
      }
      // Tick mais curto só pra manter "há Xmin" fresco no texto do dropdown — não busca dado
      // novo nenhum, só força um re-render pra recalcular formatIdade contra um `agora` novo.
      if (tick === null) {
        setAgora(new Date());
        tick = setInterval(() => setAgora(new Date()), 30_000);
      }
    }
    function stop() {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      if (tick !== null) {
        clearInterval(tick);
        tick = null;
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") start();
      else stop();
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!aberto) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [aberto]);

  const fontes = achatarFontes(detalhado);
  const corDot = fontes.length > 0 ? STATUS_VISUAL_INFO[piorStatus(fontes)].cor : null;

  return (
    <div ref={containerRef} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        title={syncing ? "Sincronização em andamento — clique para ver detalhe por fonte" : "Última sincronização concluída — clique para ver detalhe por fonte"}
      >
        {!syncing && corDot && (
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: corDot }} />
        )}
        {syncing ? (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="inline-block animate-spin">⟳</span>
            Atualizando…
          </span>
        ) : (
          <span>
            Atualizado: {formatHora(lastSyncAt)}
            {lastSyncAt && <span className="text-[var(--text-muted)]"> ({formatIdade(lastSyncAt, agora)})</span>}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-3 text-xs shadow-lg">
          <div className="mb-2 font-semibold text-[var(--text-primary)]">Status de sincronização por fonte</div>
          {fontes.length === 0 ? (
            <div className="text-[var(--text-muted)]">Sem dados ainda.</div>
          ) : (
            <ul className="flex flex-col gap-2">
              {fontes.map((f) => {
                const info = STATUS_VISUAL_INFO[f.statusVisual];
                return (
                  <li key={f.source} className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[var(--text-secondary)]">{LABEL_FONTE[f.source] ?? f.source}</span>
                      <span className="flex items-center gap-1" style={{ color: info.cor }}>
                        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: info.cor }} />
                        {info.texto}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[var(--text-muted)]">
                      <span>
                        {formatIdade(f.ultimaAtualizacaoReal, agora)}
                        {f.ultimaAtualizacaoReal && ` · ${formatHora(f.ultimaAtualizacaoReal)}`}
                      </span>
                      <span>
                        {f.recordsSynced !== null && `${f.recordsSynced} reg.`}
                        {f.duracaoMs !== null && ` · ${formatDuracao(f.duracaoMs)}`}
                      </span>
                    </div>
                    {f.statusVisual === "erro" && f.message && (
                      <div className="text-[var(--status-critical)]" title={f.message}>
                        {f.message.length > 90 ? `${f.message.slice(0, 90)}…` : f.message}
                        {f.falhasConsecutivas > 1 && ` (${f.falhasConsecutivas}x em sequência)`}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
