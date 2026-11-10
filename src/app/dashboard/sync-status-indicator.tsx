"use client";

import { useEffect, useRef, useState } from "react";

function formatHora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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

export function SyncStatusIndicator({ initialLastSyncAt }: { initialLastSyncAt: string | null }) {
  const [lastSyncAt, setLastSyncAt] = useState(initialLastSyncAt);
  const [syncing, setSyncing] = useState(false);
  const lastSyncAtRef = useRef(initialLastSyncAt);

  useEffect(() => {
    let cancelled = false;
    // setInterval atual — recriado quando o intervalo precisa mudar (passou a sincronizar/parou
    // de sincronizar), nunca comparado por identidade de função (ver restart() abaixo).
    let interval: ReturnType<typeof setInterval> | null = null;
    let currentMs = POLL_MS_NORMAL;

    async function checarStatus() {
      try {
        const res = await fetch("/api/sync-status", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data: { lastSyncAt: string | null; detalhado?: { locks?: { sync?: boolean; cancelamentos?: boolean } } } =
          await res.json();
        if (cancelled) return;
        if (data.lastSyncAt && data.lastSyncAt !== lastSyncAtRef.current) {
          lastSyncAtRef.current = data.lastSyncAt;
          setLastSyncAt(data.lastSyncAt);
        }
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
      if (interval !== null) return;
      checarStatus();
      interval = setInterval(checarStatus, currentMs);
    }
    function stop() {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
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

  return (
    <span className="hidden items-center gap-1 text-xs text-[var(--text-muted)] sm:inline-flex" title={syncing ? "Sincronização em andamento" : "Última sincronização concluída"}>
      {syncing ? (
        <>
          <span aria-hidden className="inline-block animate-spin">⟳</span>
          Atualizando…
        </>
      ) : (
        `Atualizado: ${formatHora(lastSyncAt)}`
      )}
    </span>
  );
}
