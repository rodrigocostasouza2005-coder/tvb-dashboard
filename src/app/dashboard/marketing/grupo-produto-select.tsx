"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { RawSearchParams } from "@/lib/filters";

function buildHref(basePath: string, searchParams: RawSearchParams, grupo: string) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "grupoFiltro" || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else qs.append(key, value);
  }
  if (grupo) qs.set("grupoFiltro", grupo);
  return `${basePath}?${qs.toString()}`;
}

// Dropdown "Grupo de produto" pra estreitar o ranking (pedido do Rodrigo em 2026-09-15) — junto
// com o DimensionToggle já existente (Grupo/Produto/Tamanho), escolher um grupo aqui e trocar o
// toggle pra "Produto" mostra só os produtos daquele grupo, em vez do ranking misturado da loja
// inteira. Mesmo padrão de navegação via Link/URL do DimensionToggle e do ModoToggle, só que
// como <select> nativo em vez de botões — precisa de client component pelo onChange.
export function GrupoProdutoSelect({
  basePath,
  searchParams,
  grupos,
  current,
}: {
  basePath: string;
  searchParams: RawSearchParams;
  grupos: string[];
  current?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <div className="mb-4 flex items-center gap-2" aria-busy={isPending} style={{ opacity: isPending ? 0.6 : 1, transition: "opacity 0.15s ease" }}>
      <label htmlFor="grupoFiltro" className="text-xs font-medium text-[var(--text-muted)]">
        Grupo de produto:
      </label>
      <select
        id="grupoFiltro"
        defaultValue={current ?? ""}
        onChange={(e) =>
          startTransition(() => {
            router.push(buildHref(basePath, searchParams, e.target.value), { scroll: false });
          })
        }
        className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
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
