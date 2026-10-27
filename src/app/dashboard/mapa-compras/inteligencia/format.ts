import type { IndicadorCobertura } from "@/lib/metrics";

export function formatMoeda(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function formatNumero(v: number | null | undefined, decimais = 0): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: decimais, maximumFractionDigits: decimais });
}

export function formatPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

// Mesma convenção visual de status-filter.tsx (statusFor) — reaproveita as 3 cores que o resto
// do Radar já usa pra "bom/atenção/crítico", em vez de inventar uma paleta nova pro indicador de
// excesso/insuficiência/equilíbrio (seção 6 do pedido: sobriedade visual, sem exagero de cor).
export function indicadorInfo(indicador: IndicadorCobertura): { label: string; color: string } {
  switch (indicador) {
    case "excesso":
      return { label: "Excesso", color: "var(--status-warning)" };
    case "insuficiencia":
      return { label: "Insuficiência", color: "var(--status-critical)" };
    case "equilibrio":
      return { label: "Equilíbrio", color: "var(--status-good)" };
  }
}

export const STATUS_COMERCIAL_LABEL: Record<string, string> = {
  ATIVO: "Ativo",
  EM_LANCAMENTO: "Em lançamento",
  EM_REPOSICAO: "Em reposição",
  EM_ENCERRAMENTO: "Em encerramento",
  DESCONTINUADO: "Descontinuado",
};

export const POSSIBILIDADE_REPOSICAO_LABEL: Record<string, string> = {
  SIM: "Sim",
  NAO: "Não",
  A_CONFIRMAR: "A confirmar",
};
