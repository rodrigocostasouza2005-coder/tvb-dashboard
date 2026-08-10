"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

// Por padrão mostra o gráfico por Grupo; ao escolher um grupo aqui, troca pra mostrar os
// produtos daquele grupo (ver uso em page.tsx: dimension vira "produto" + grupoIn = [grupo]).
export function GrupoDrillSelect({ grupos, current }: { grupos: string[]; current: string }) {
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
        Ver produtos de um grupo
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
