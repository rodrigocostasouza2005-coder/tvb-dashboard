"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function AtacadoProspeccaoError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // O Next registra o erro no servidor; não exibimos detalhes internos nem dados do banco.
    console.error("Falha ao carregar a área de prospecção de atacado:", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[55vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 text-4xl" aria-hidden="true">⚠️</div>
      <h1 className="text-lg font-semibold text-[var(--text-primary)]">
        Não foi possível carregar a Prospecção
      </h1>
      <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
        Pode ser uma instabilidade momentânea ou a estrutura da área ainda não ter sido
        criada no banco de dados. Tente novamente. Se o erro persistir, a migration
        <code className="mx-1 rounded bg-[var(--surface-2)] px-1 py-0.5 text-xs">
          20261103190000_add_atacado_prospects
        </code>
        precisa ser verificada e aplicada no banco correto.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Código para suporte: {error.digest}
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-[var(--series-1)] px-4 py-2 text-sm font-medium text-white"
        >
          Tentar novamente
        </button>
        <Link
          href="/dashboard/atacado"
          className="rounded-md border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)]"
        >
          Voltar para Atacado
        </Link>
      </div>
    </main>
  );
}
