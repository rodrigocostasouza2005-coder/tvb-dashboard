import type { Avaliabilidade } from "@/lib/metrics";

// Fase 2B — avaliação retrospectiva de decisão de compra. Mesma convenção de rótulo/cor já usada
// em planejamento-estoque/format.tsx (tokens --status-* do globals.css, nunca paleta nova).
export const AVALIABILIDADE_LABEL: Record<Avaliabilidade, string> = {
  SEM_DADOS: "Sem dado suficiente",
  PARCIAL: "Parcial",
  COMPLETA: "Completa",
};

export const AVALIABILIDADE_COR: Record<Avaliabilidade, string> = {
  SEM_DADOS: "text-[var(--text-muted)]",
  PARCIAL: "text-[var(--status-warning)]",
  COMPLETA: "text-[var(--status-good)]",
};

export function formatDataCurta(d: Date): string {
  return new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
