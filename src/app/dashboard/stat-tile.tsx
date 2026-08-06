const STATUS_COLOR: Record<string, string> = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  critical: "var(--status-critical)",
};

export function StatTile({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status?: "good" | "warning" | "critical";
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
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
      </div>
    </div>
  );
}
