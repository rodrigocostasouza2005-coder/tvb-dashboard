"use client";

import { useActionState } from "react";
import { recuperarVendasFaltantesAction } from "./actions";

type State = { ok: boolean; message: string };

const initialState: State = { ok: true, message: "" };

// Recuperação pontual (não é a sincronização de rotina) — reprocessa os últimos 10 dias pra
// repor venda que não chegou a ser gravada por causa do bug do forceSyncAction (corrigido em
// 2026-10-27, ver actions.ts). Idempotente: pode clicar mais de uma vez sem duplicar nada.
export function RecuperarVendasButton() {
  const [state, formAction, isPending] = useActionState<State, FormData>(
    async () => recuperarVendasFaltantesAction(),
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <button
        type="submit"
        disabled={isPending}
        className="w-fit rounded-md bg-[var(--series-2)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Recuperando (pode levar alguns minutos)..." : "Recuperar vendas recentes faltantes"}
      </button>
      {state.message && (
        <p
          className="text-xs"
          style={{ color: state.ok ? "var(--status-good)" : "var(--status-critical)" }}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
