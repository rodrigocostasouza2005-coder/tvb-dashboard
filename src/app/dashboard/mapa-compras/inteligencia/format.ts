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
