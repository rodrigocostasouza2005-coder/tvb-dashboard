"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

// Em Grupo, funciona como drill-down (escolher aqui troca pra ver os Produtos daquele grupo —
// dimension vira "produto" + grupoIn = [grupo] em page.tsx). Em Produto/Tamanho, só filtra a
// visão atual pro grupo escolhido, sem trocar de dimensão (pedido do Rodrigo em 2026-08-28).
export function GrupoDrillSelect({ grupos, current, label }: { grupos: string[]; current: string; label?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function onChange(value: string) {
    const qs = new URLSearchParams(searchParams.toString());
    if (value) qs.set("grupo", value);
    else qs.delete("grupo");
    router.push(`${pathname}?${qs.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-col gap-1">
      <label className="text-xs text-[var(--text-muted)]" htmlFor="grupo-drill">
        {label ?? "Ver produtos de um grupo"}
      </label>
      <select
        id="grupo-drill"
        value={current}
        onChange={(e) => onChange(e.target.value)}
        className="w-fit rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]"
        style={{ colorScheme: "light dark" }}
      >
        <option value="">Todos os grupos</option>
        {grupos.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
    </div>
  );
}
