import type {
  Diagnostico,
  ClassificacaoMovimentacao,
  Confianca,
  Prioridade,
  TipoMovimentacao,
} from "@/lib/metrics";

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

// Mesmos tokens --status-* do diagnóstico acima — a cor comunica a MESMA coisa nas duas leituras
// (vermelho = falta de atendimento, amarelo = otimização, verde = situação ok), em vez de uma
// segunda paleta só pra classificação.
export function classificacaoInfo(c: ClassificacaoMovimentacao): { label: string; color: string; descricao: string } {
  switch (c) {
    case "REDISTRIBUIR":
      return {
        label: "Redistribuir",
        color: "var(--series-1)",
        descricao: "Excesso numa posição + necessidade comprovada em outra.",
      };
    case "RECOLHER_PARA_CD_SITE":
      return {
        label: "Recolher p/ CD-Site",
        color: "var(--status-warning)",
        descricao: "A peça tende a ser melhor aproveitada no ecommerce que na posição atual.",
      };
    case "MANTER":
      return {
        label: "Manter",
        color: "var(--status-good)",
        descricao: "Há justificativa comercial pra não mover, mesmo com aparente excesso.",
      };
  }
}

export function prioridadeInfo(p: Prioridade): { label: string; color: string } {
  switch (p) {
    case "alta":
      return { label: "Alta", color: "var(--status-critical)" };
    case "media":
      return { label: "Média", color: "var(--status-serious)" };
    case "baixa":
      return { label: "Baixa", color: "var(--text-muted)" };
  }
}

export function confiancaInfo(c: Confianca): { label: string; color: string } {
  switch (c) {
    case "alta":
      return { label: "Confiança alta", color: "var(--status-good)" };
    case "media":
      return { label: "Confiança média", color: "var(--status-warning)" };
    case "baixa":
      return { label: "Baixa confiança — depende de validação", color: "var(--status-critical)" };
  }
}

export const TIPOS_MOVIMENTACAO: { value: TipoMovimentacao; label: string }[] = [
  { value: "loja_loja", label: "Loja → Loja" },
  { value: "cd_site_loja", label: "CD/Site → Loja" },
  { value: "loja_cd_site", label: "Loja → CD/Site" },
];

export function situacaoInfo(s: "falta" | "excesso" | "equilibrado" | "sem_dado"): { label: string; color: string } {
  switch (s) {
    case "falta":
      return { label: "Falta estoque", color: "var(--status-critical)" };
    case "excesso":
      return { label: "Excesso", color: "var(--status-warning)" };
    case "equilibrado":
      return { label: "Equilibrado", color: "var(--status-good)" };
    case "sem_dado":
      return { label: "Sem dado", color: "var(--text-muted)" };
  }
}

export function statusHistoricoInfo(s: string): { label: string; color: string } {
  switch (s) {
    case "PENDENTE":
      return { label: "Pendente", color: "var(--text-muted)" };
    case "APROVADA":
      return { label: "Aprovada", color: "var(--series-1)" };
    case "EXECUTADA":
      return { label: "Executada", color: "var(--status-good)" };
    case "RECUSADA":
      return { label: "Recusada", color: "var(--status-critical)" };
    default:
      return { label: s, color: "var(--text-muted)" };
  }
}
