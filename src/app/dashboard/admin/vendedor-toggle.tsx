"use client";

import { useActionState } from "react";
import { ativarVendedorAction, desativarVendedorAction } from "./actions";

type State = { ok: boolean; message: string };
const initialState: State = { ok: true, message: "" };

// Ativar/desativar vendedor — pedido do Rodrigo em 2026-09-21. Desativar dispara redistribuição
// da carteira dele (ver desativarVendedorAction), por isso o retorno vem com uma mensagem
// explicando quantos clientes foram redistribuídos, não é um toggle silencioso.
export function VendedorToggle({ vendedorId, nome, ativo }: { vendedorId: string; nome: string; ativo: boolean }) {
  const [state, formAction, isPending] = useActionState<State, FormData>(async (_prev, formData) => {
    if (ativo) return desativarVendedorAction(formData);
    await ativarVendedorAction(formData);
    return { ok: true, message: `${nome} reativado.` };
  }, initialState);

  return (
    <div className="flex flex-col gap-1">
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="vendedorId" value={vendedorId} />
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">{nome}</span>
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: ativo ? "var(--status-good)" : "var(--status-critical)" }}
          aria-hidden
        />
        <button
          type="submit"
          disabled={isPending}
          className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--page-plane)] disabled:opacity-50"
        >
          {isPending ? "..." : ativo ? "Desativar" : "Reativar"}
        </button>
      </form>
      {state.message && (
        <p className="text-xs" style={{ color: state.ok ? "var(--status-good)" : "var(--status-critical)" }}>
          {state.message}
        </p>
      )}
    </div>
  );
}
