import type { ClassificacaoAgregada, Tendencia } from "@/lib/metrics";
import type { Diagnostico } from "@/lib/metrics";

export function formatNumber(value: number) {
  return value.toLocaleString("pt-BR");
}

export const SITUACAO_LABEL: Record<Diagnostico, string> = {
  sem_dado: "Sem dado suficiente",
  ruptura: "Ruptura",
  cobertura_critica: "Cobertura crítica",
  equilibrado: "Equilibrado",
  cobertura_excessiva: "Possível excesso",
  estoque_parado: "Sem movimentação",
};

// Mesmos tokens de status já definidos em globals.css (--status-good/warning/serious/critical)
// — não inventa paleta nova só pra este módulo.
export const SITUACAO_COR: Record<Diagnostico, string> = {
  sem_dado: "text-[var(--text-muted)]",
  ruptura: "text-[var(--status-critical)]",
  cobertura_critica: "text-[var(--status-serious)]",
  equilibrado: "text-[var(--status-good)]",
  cobertura_excessiva: "text-[var(--status-warning)]",
  estoque_parado: "text-[var(--status-warning)]",
};

export const CLASSIFICACAO_LABEL: Record<ClassificacaoAgregada, string> = {
  BEST_SELLER: "Best Seller",
  DROP: "Drop",
  MISTO: "Misto (tamanhos divergem)",
  NAO_CLASSIFICADO: "Não classificado",
};

export const TENDENCIA_LABEL: Record<Tendencia, string> = {
  crescimento: "↑ Crescimento",
  estavel: "→ Estável",
  desaceleracao: "↓ Desaceleração",
  sem_dado: "—",
};

export const TENDENCIA_COR: Record<Tendencia, string> = {
  crescimento: "text-[var(--status-good)]",
  estavel: "text-[var(--text-secondary)]",
  desaceleracao: "text-[var(--status-warning)]",
  sem_dado: "text-[var(--text-muted)]",
};
