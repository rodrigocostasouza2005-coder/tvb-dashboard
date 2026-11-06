"use client";

import { useActionState } from "react";
import { importarMetaDiariaBlackFridayAction } from "./actions";

type State = { ok: boolean; message: string };

const initialState: State = { ok: true, message: "" };

// Importa/atualiza MetaDiariaBlackFriday a partir do JSON commitado no repo (ver comentário da
// action). Idempotente — pode clicar de novo sem medo (upsert por data). Mesmo padrão de
// ImportarPrecosBfButton.
export function ImportarMetaDiariaBfButton() {
  const [state, formAction, isPending] = useActionState<State, FormData>(
    async () => importarMetaDiariaBlackFridayAction(),
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <button
        type="submit"
        disabled={isPending}
        className="w-fit rounded-md bg-[var(--series-1)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Importando..." : "Importar meta diária Black Friday"}
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
