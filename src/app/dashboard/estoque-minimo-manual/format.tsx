import type { NivelAlertaMinimoManual } from "@/lib/metrics";

export function formatNumero(value: number) {
  return value.toLocaleString("pt-BR");
}

// Mesmos 4 tokens de status já usados em planejamento-estoque/format.tsx (--status-critical/
// warning/good + --text-muted pra "sem dado") — não inventa paleta nova só pra este módulo.
export const NIVEL_LABEL: Record<NivelAlertaMinimoManual, string> = {
  CRITICO: "Crítico",
  ATENCAO: "Atenção",
  NORMAL: "Normal",
  SEM_MINIMO_DEFINIDO: "Sem mínimo definido",
};

export const NIVEL_COR: Record<NivelAlertaMinimoManual, string> = {
  CRITICO: "var(--status-critical)",
  ATENCAO: "var(--status-warning)",
  NORMAL: "var(--status-good)",
  SEM_MINIMO_DEFINIDO: "var(--text-muted)",
};

export function NivelBadge({ nivel }: { nivel: NivelAlertaMinimoManual }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: NIVEL_COR[nivel] }} />
      <span style={{ color: NIVEL_COR[nivel] }}>{NIVEL_LABEL[nivel]}</span>
    </span>
  );
}
