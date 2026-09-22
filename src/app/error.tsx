"use client";

import { useEffect } from "react";

// Fallback pra erro fora do escopo de dashboard/error.tsx — ex: falha dentro do próprio
// dashboard/layout.tsx (getSessionUser, scheduleCatchupSyncIfStale) ou na página de login, que
// não ficam debaixo do error.tsx mais específico do dashboard.
export default function RootError({
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--page-plane)] px-6 text-center text-[var(--text-primary)]">
      <div className="text-3xl">⚠️</div>
      <h1 className="text-sm font-semibold">O TVB Radar não carregou</h1>
      <p className="max-w-sm text-sm text-[var(--text-secondary)]">
        Pode ter sido um engasgo momentâneo na conexão com o banco. Tenta de novo em alguns segundos.
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
