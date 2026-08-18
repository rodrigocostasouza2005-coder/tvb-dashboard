import Link from "next/link";
import type { Dimension } from "@/lib/metrics";
import type { RawSearchParams } from "@/lib/filters";

const OPTIONS: { value: Dimension; label: string; sellthroughOnly?: boolean }[] = [
  { value: "grupo", label: "Grupo de produto" },
  { value: "produto", label: "Produto" },
  { value: "tamanho", label: "Tamanho" },
  { value: "colecao", label: "Coleção", sellthroughOnly: true },
];

function buildHref(basePath: string, searchParams: RawSearchParams, dim: Dimension) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "dim" || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else qs.append(key, value);
  }
  qs.set("dim", dim);
  return `${basePath}?${qs.toString()}`;
}

export function DimensionToggle({
  basePath,
  searchParams,
  current,
  showColecao = false,
}: {
  basePath: string;
  searchParams: RawSearchParams;
  current: Dimension;
  showColecao?: boolean;
}) {
  const options = OPTIONS.filter((o) => !o.sellthroughOnly || showColecao);
  return (
    <div className="mb-4 flex gap-1">
      {options.map((opt) => (
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
  );
}
