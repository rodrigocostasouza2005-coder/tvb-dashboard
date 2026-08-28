"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

// Multi-seleção (pedido do Rodrigo em 2026-08-28, substituindo o <select> de opção única).
// Em Grupo, funciona como drill-down (escolher aqui troca pra ver os Produtos daquele(s)
// grupo(s) — dimension vira "produto" + grupoIn = grupos selecionados em page.tsx). Em Produto/
// Tamanho, só filtra a visão atual pros grupos escolhidos, sem trocar de dimensão.
export function GrupoDrillSelect({ grupos, current, label }: { grupos: string[]; current: string[]; label?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function toggle(value: string) {
    const qs = new URLSearchParams(searchParams.toString());
    qs.delete("grupo");
    const next = current.includes(value) ? current.filter((g) => g !== value) : [...current, value];
    for (const g of next) qs.append("grupo", g);
    router.push(`${pathname}?${qs.toString()}`);
  }

  function clear() {
    const qs = new URLSearchParams(searchParams.toString());
    qs.delete("grupo");
    router.push(`${pathname}?${qs.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-col gap-1">
      <span className="text-xs text-[var(--text-muted)]">{label ?? "Filtrar por grupo de produto"}</span>
      <details className="group relative w-fit">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--page-plane)] [&::-webkit-details-marker]:hidden">
          {current.length === 0 ? "Todos os grupos" : `${current.length} selecionado${current.length > 1 ? "s" : ""}`}
          <span aria-hidden className="text-[10px] text-[var(--text-muted)] transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="absolute left-0 z-10 mt-2 max-h-72 min-w-[240px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 shadow-lg">
          <div className="flex flex-col gap-1.5">
            {current.length > 0 && (
              <button
                type="button"
                onClick={clear}
                className="mb-1 self-start text-xs text-[var(--series-1)] hover:underline"
              >
                Limpar seleção
              </button>
            )}
            {grupos.map((g) => (
              <label key={g} className="flex items-center gap-1.5 whitespace-nowrap text-sm text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={current.includes(g)}
                  onChange={() => toggle(g)}
                  className="accent-[var(--series-1)]"
                />
                {g}
              </label>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}
