"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

// Multi-seleção de grupo(s) de produto — pedido do Rodrigo em 2026-09-01, filtro de verdade (não
// só clicar na barra do painel Grupo) que também reduz os totais (Estoque atual/Vendido no
// período) e os 3 painéis, não só o que já vem carregado no navegador. Mesma UX do PcKeySelect.
export function GrupoFilterSelect({ options, current }: { options: string[]; current: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function toggle(value: string) {
    const qs = new URLSearchParams(searchParams.toString());
    qs.delete("grupo");
    const next = current.includes(value) ? current.filter((k) => k !== value) : [...current, value];
    for (const k of next) qs.append("grupo", k);
    router.push(`${pathname}?${qs.toString()}`);
  }

  function clear() {
    const qs = new URLSearchParams(searchParams.toString());
    qs.delete("grupo");
    router.push(`${pathname}?${qs.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-col gap-1">
      <span className="text-xs text-[var(--text-muted)]">Grupo de produto</span>
      <details className="group relative w-fit">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--page-plane)] [&::-webkit-details-marker]:hidden">
          {current.length === 0 ? "Todos os grupos" : `${current.length} selecionado${current.length > 1 ? "s" : ""}`}
          <span aria-hidden className="text-[10px] text-[var(--text-muted)] transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="absolute left-0 z-10 mt-2 max-h-72 min-w-[280px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 shadow-lg">
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
            {options.map((o) => (
              <label key={o} className="flex items-center gap-1.5 whitespace-nowrap text-sm text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={current.includes(o)}
                  onChange={() => toggle(o)}
                  className="accent-[var(--series-1)]"
                />
                {o}
              </label>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}
