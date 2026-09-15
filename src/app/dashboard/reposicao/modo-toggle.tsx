import Link from "next/link";
import type { RawSearchParams } from "@/lib/filters";

export type ReplenishmentModo = "minimo" | "vendas";

const OPTIONS: { value: ReplenishmentModo; label: string }[] = [
  { value: "minimo", label: "Estoque Mínimo" },
  { value: "vendas", label: "Vendas" },
];

function buildHref(basePath: string, searchParams: RawSearchParams, modo: ReplenishmentModo) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "modo" || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else qs.append(key, value);
  }
  qs.set("modo", modo);
  return `${basePath}?${qs.toString()}`;
}

// Seletor de modo de reposição (2026-09-15, pedido do Rodrigo) — mesmo padrão visual/técnico do
// DimensionToggle (link normal, sem client component), só que trocando "modo" em vez de "dim".
// Padrão continua sendo "minimo" pra preservar o comportamento de sempre (ver parseReplenishmentModo).
export function ModoToggle({
  basePath,
  searchParams,
  current,
}: {
  basePath: string;
  searchParams: RawSearchParams;
  current: ReplenishmentModo;
}) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="text-xs font-medium text-[var(--text-muted)]">Modo de reposição:</span>
      <div className="flex gap-1">
        {OPTIONS.map((opt) => (
          <Link
            key={opt.value}
            href={buildHref(basePath, searchParams, opt.value)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              current === opt.value
                ? "bg-[var(--series-1)] text-white"
                : "border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-1)]"
            }`}
          >
            {opt.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function parseReplenishmentModo(params: RawSearchParams): ReplenishmentModo {
  return params.modo === "vendas" ? "vendas" : "minimo";
}
