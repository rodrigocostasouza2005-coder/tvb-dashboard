import Link from "next/link";
import type { RawSearchParams } from "@/lib/filters";

export type Modo = "consolidado" | "best-seller" | "drop" | "grupo" | "produto" | "alertas";

const OPTIONS: { value: Modo; label: string }[] = [
  { value: "consolidado", label: "Visão consolidada" },
  { value: "best-seller", label: "Best Seller" },
  { value: "drop", label: "Drops" },
  { value: "grupo", label: "Por grupo" },
  { value: "produto", label: "Por produto" },
  { value: "alertas", label: "Alertas e prioridades" },
];

// Mesmo padrão de dimension-toggle.tsx: Link server-rendered trocando 1 param da URL, mantendo
// os demais (filtros de grupo/coleção/status/horizonte sobrevivem à troca de modo).
function buildHref(basePath: string, searchParams: RawSearchParams, modo: Modo) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "modo" || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else qs.append(key, value);
  }
  qs.set("modo", modo);
  return `${basePath}?${qs.toString()}`;
}

export function ModoToggle({
  basePath,
  searchParams,
  current,
}: {
  basePath: string;
  searchParams: RawSearchParams;
  current: Modo;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-1">
      {OPTIONS.map((opt) => (
        <Link
          key={opt.value}
          href={buildHref(basePath, searchParams, opt.value)}
          scroll={false}
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
  );
}
