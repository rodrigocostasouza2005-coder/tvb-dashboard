"use client";

import { useActionState } from "react";
import { forceSyncAction } from "./actions";

type State = { ok: boolean; message: string };

const initialState: State = { ok: true, message: "" };

// A sincronização pode levar até alguns minutos (estoque de 4 lojas + faturas) — o botão fica
// desabilitado com "Sincronizando..." até a Server Action voltar, não é fire-and-forget.
export function ForceSyncButton() {
  const [state, formAction, isPending] = useActionState<State, FormData>(
    async () => forceSyncAction(),
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <button
        type="submit"
        disabled={isPending}
        className="w-fit rounded-md bg-[var(--series-1)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Disparando..." : "Forçar atualização agora"}
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
