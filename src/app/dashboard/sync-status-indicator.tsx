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
export function SyncStatusIndicator({ initialLastSyncAt }: { initialLastSyncAt: string | null }) {
  const [lastSyncAt, setLastSyncAt] = useState(initialLastSyncAt);
  const lastSyncAtRef = useRef(initialLastSyncAt);

  useEffect(() => {
    let cancelled = false;

    async function checarStatus() {
      try {
        const res = await fetch("/api/sync-status", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data: { lastSyncAt: string | null } = await res.json();
        if (cancelled || !data.lastSyncAt) return;
        if (data.lastSyncAt !== lastSyncAtRef.current) {
          lastSyncAtRef.current = data.lastSyncAt;
          setLastSyncAt(data.lastSyncAt);
        }
      } catch {
        // Falha de rede/polling não deve derrubar o indicador — mantém o último horário conhecido.
      }
    }

    let interval: ReturnType<typeof setInterval> | null = null;
    function start() {
      if (interval !== null) return;
      checarStatus();
      interval = setInterval(checarStatus, 60_000);
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
    <span className="hidden text-xs text-[var(--text-muted)] sm:inline" title="Última sincronização concluída">
      Atualizado: {formatHora(lastSyncAt)}
    </span>
  );
}
