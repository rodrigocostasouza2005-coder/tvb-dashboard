import type { Diagnostico } from "@/lib/metrics";

export function formatNumero(v: number | null | undefined, decimais = 0): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: decimais, maximumFractionDigits: decimais });
}

// Mesma convenção visual de status-filter.tsx/mapa-compras/inteligencia/format.ts (indicadorInfo)
// — reaproveita os tokens --status-* já usados no resto do Radar em vez de inventar paleta nova.
export function diagnosticoInfo(d: Diagnostico): { label: string; color: string } {
  switch (d) {
    case "ruptura":
      return { label: "Ruptura", color: "var(--status-critical)" };
    case "cobertura_critica":
      return { label: "Cobertura crítica", color: "var(--status-serious)" };
    case "estoque_parado":
      return { label: "Estoque parado", color: "var(--status-warning)" };
    case "cobertura_excessiva":
      return { label: "Excesso", color: "var(--status-warning)" };
    case "equilibrado":
      return { label: "Equilibrado", color: "var(--status-good)" };
    case "sem_dado":
      return { label: "Sem dado suficiente", color: "var(--text-muted)" };
  }
}
