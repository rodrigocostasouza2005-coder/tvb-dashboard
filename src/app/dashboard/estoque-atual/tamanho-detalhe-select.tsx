"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { RawSearchParams } from "@/lib/filters";

function buildHref(basePath: string, searchParams: RawSearchParams, tamanho: string) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "tamanhoDetalhe" || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else qs.append(key, value);
  }
  if (tamanho) qs.set("tamanhoDetalhe", tamanho);
  return `${basePath}?${qs.toString()}`;
}

// Dropdown "ver produtos deste tamanho" na visão Tamanho da aba Estoque Atual — pedido do
// Rodrigo em 2026-10-06: "42" sozinho mistura produto de famílias diferentes, ele quer escolher
// um tamanho e ver só os produtos que têm estoque nele. Mesmo padrão de navegação via
// router.push+startTransition já usado em GrupoProdutoSelect (Marketing) — startTransition evita
// a tela branca que o loading.tsx genérico causava (ver get-form.tsx), componente próprio porque
// o nome do parâmetro de URL é outro (tamanhoDetalhe, não grupoFiltro).
export function TamanhoDetalheSelect({
  basePath,
  searchParams,
  tamanhos,
  current,
}: {
  basePath: string;
  searchParams: RawSearchParams;
  tamanhos: string[];
  current?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <div className="mb-4 flex items-center gap-2" aria-busy={isPending} style={{ opacity: isPending ? 0.6 : 1, transition: "opacity 0.15s ease" }}>
      <label htmlFor="tamanhoDetalhe" className="text-xs font-medium text-[var(--text-muted)]">
        Ver produtos do tamanho:
      </label>
      <select
        id="tamanhoDetalhe"
        defaultValue={current ?? ""}
        onChange={(e) =>
          startTransition(() => {
            router.push(buildHref(basePath, searchParams, e.target.value), { scroll: false });
          })
        }
        className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
        style={{ colorScheme: "light dark" }}
      >
        <option value="">Selecione um tamanho...</option>
        {tamanhos.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}
