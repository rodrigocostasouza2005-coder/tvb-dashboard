"use client";

import { useEffect } from "react";

// Erro dentro de qualquer aba (page.tsx debaixo de /dashboard) cai aqui — o header e o menu de
// abas continuam visíveis (definidos em layout.tsx, que não é coberto por esse boundary), só o
// conteúdo da aba vira essa tela. Causa mais comum: engasgo momentâneo de conexão com o banco
// (Neon "server closed the connection" — já vimos isso acontecer no meio de scripts nesta mesma
// sessão), por isso o foco é "tenta de novo" em vez de uma mensagem de erro técnica.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-6 py-12 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="text-3xl">⚠️</div>
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">Essa aba não carregou</h2>
      <p className="max-w-sm text-sm text-[var(--text-secondary)]">
        Pode ter sido um engasgo momentâneo na conexão com o banco. Tenta de novo — se continuar acontecendo, avisa o Rodrigo.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-2 rounded-md bg-[var(--series-1)] px-4 py-1.5 text-sm font-medium text-white"
      >
        Tentar de novo
      </button>
    </div>
  );
}
