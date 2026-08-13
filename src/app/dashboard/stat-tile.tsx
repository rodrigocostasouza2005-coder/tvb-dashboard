const STATUS_COLOR: Record<string, string> = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  critical: "var(--status-critical)",
};

export function StatTile({
  label,
  value,
  status,
  trend,
}: {
  label: string;
  value: string;
  status?: "good" | "warning" | "critical";
  // Seta indicando direção — hoje só "up" (verde) é usado (ex: clientes novos > 0).
  trend?: "up" | "down";
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
      <div className="text-xs font-medium text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
          {value}
        </span>
        {status && (
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: STATUS_COLOR[status] }}
          />
        )}
        {trend && (
          <span
            aria-hidden
            className="text-base leading-none"
            style={{ color: trend === "up" ? "var(--status-good)" : "var(--status-critical)" }}
          >
            {trend === "up" ? "▲" : "▼"}
          </span>
        )}
      </div>
    </div>
  );
}
