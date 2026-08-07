import Link from "next/link";
import type { RawSearchParams } from "@/lib/filters";

export type StatusKey = "good" | "warning" | "critical";

const OPTIONS: { value: StatusKey | ""; label: string; color?: string }[] = [
  { value: "", label: "Todos" },
  { value: "good", label: "Bom", color: "var(--status-good)" },
  { value: "warning", label: "Atenção", color: "var(--status-warning)" },
  { value: "critical", label: "Crítico", color: "var(--status-critical)" },
];

function buildHref(basePath: string, searchParams: RawSearchParams, status: string) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "status" || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else qs.append(key, value);
  }
  if (status) qs.set("status", status);
  return `${basePath}?${qs.toString()}`;
}

export function StatusFilter({
  basePath,
  searchParams,
  current,
}: {
  basePath: string;
  searchParams: RawSearchParams;
  current: string;
}) {
  return (
    <div className="mb-4 flex gap-1">
      {OPTIONS.map((opt) => (
        <Link
          key={opt.value}
          href={buildHref(basePath, searchParams, opt.value)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
            current === opt.value
              ? "bg-[var(--series-1)] text-white"
              : "border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-1)]"
          }`}
        >
          {opt.color && (
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: current === opt.value ? "white" : opt.color }}
            />
          )}
          {opt.label}
        </Link>
      ))}
    </div>
  );
}

export function statusFor(rate: number | null): { label: string; color: string; key: StatusKey | null } {
  if (rate === null) return { label: "—", color: "var(--text-muted)", key: null };
  if (rate >= 50) return { label: "Bom", color: "var(--status-good)", key: "good" };
  if (rate >= 30) return { label: "Atenção", color: "var(--status-warning)", key: "warning" };
  return { label: "Crítico", color: "var(--status-critical)", key: "critical" };
}
