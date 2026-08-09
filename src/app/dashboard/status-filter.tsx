export type StatusKey = "good" | "warning" | "critical";

export function statusFor(rate: number | null): { label: string; color: string; key: StatusKey | null } {
  if (rate === null) return { label: "—", color: "var(--text-muted)", key: null };
  if (rate >= 50) return { label: "Bom", color: "var(--status-good)", key: "good" };
  if (rate >= 30) return { label: "Atenção", color: "var(--status-warning)", key: "warning" };
  return { label: "Crítico", color: "var(--status-critical)", key: "critical" };
}
