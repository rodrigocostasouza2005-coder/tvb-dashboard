"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Modo de apresentação/uso do telefone (Celular vs Computador) — pedido do Rodrigo em
// 2026-09-18, inicialmente só na aba Sugestão de Contato, depois estendido pro TVB Radar
// inteiro (2026-09-18, mesma sessão: "eu queria ajustar a formatação para escolher para todo o
// radar") — por isso mora em src/app/dashboard/ (nível do layout, não de uma aba específica) e o
// Provider é montado 1x em dashboard/layout.tsx, cobrindo qualquer página embaixo dele.
// É só preferência de EXIBIÇÃO (nunca muda o número usado no link do WhatsApp, nem o valor
// salvo no banco), então localStorage é suficiente — não precisa ida ao servidor.
export type PhoneMode = "mobile" | "desktop";

const STORAGE_KEY = "tvb_phone_mode";

const PhoneModeContext = createContext<{ mode: PhoneMode; setMode: (m: PhoneMode) => void; ready: boolean }>({
  mode: "desktop",
  setMode: () => {},
  ready: false,
});

export function PhoneModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<PhoneMode>("desktop");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "mobile" || saved === "desktop") {
      setModeState(saved);
    } else {
      // Detecção automática: dispositivo com ponteiro "grosso" (touch) = celular, na 1ª visita
      // sem preferência salva ainda. O usuário pode sempre trocar manualmente depois.
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      setModeState(coarse ? "mobile" : "desktop");
    }
    setReady(true);
  }, []);

  function setMode(m: PhoneMode) {
    setModeState(m);
    window.localStorage.setItem(STORAGE_KEY, m);
  }

  return <PhoneModeContext.Provider value={{ mode, setMode, ready }}>{children}</PhoneModeContext.Provider>;
}

export function usePhoneMode() {
  return useContext(PhoneModeContext);
}

// `compact` (sem texto, só os emojis) é usado no header do dashboard, que já é apertado em
// telas menores — a versão com texto continua disponível pra onde tiver mais espaço sobrando.
export function PhoneModeToggle({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = usePhoneMode();
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-[var(--border)] text-sm" title="Formato de telefone">
      <button
        type="button"
        onClick={() => setMode("mobile")}
        title="Celular"
        className={`px-2.5 py-1.5 transition-colors ${mode === "mobile" ? "bg-[var(--series-1)] text-white" : "bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"}`}
      >
        {compact ? "📱" : "📱 Celular"}
      </button>
      <button
        type="button"
        onClick={() => setMode("desktop")}
        title="Computador"
        className={`px-2.5 py-1.5 transition-colors ${mode === "desktop" ? "bg-[var(--series-1)] text-white" : "bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"}`}
      >
        {compact ? "💻" : "💻 Computador"}
      </button>
    </div>
  );
}
