// Labels/estilos puros da seção "Qualificação B2B" — sem hooks, usável de componentes server
// ou client. Centralizado aqui pra não divergir texto entre as tabelas de aprovados/pendentes/
// reprovados (as três mostram classificação/critério/tipo de evidência com os mesmos termos).

export const CLASSIFICACAO_LABEL: Record<string, string> = {
  ALTA_PRIORIDADE: "Alta prioridade",
  QUALIFICADO: "Qualificado",
  REPROVADO: "Reprovado",
};

export const CLASSIFICACAO_BADGE_CLASS: Record<string, string> = {
  ALTA_PRIORIDADE: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
  QUALIFICADO: "border-blue-500/40 bg-blue-500/10 text-blue-700",
  REPROVADO: "border-red-500/40 bg-red-500/10 text-red-700",
};

export const TIPO_ESTABELECIMENTO_LABEL: Record<string, string> = {
  MATRIZ: "Matriz",
  FILIAL: "Filial",
};

export const CONFIANCA_LABEL: Record<string, string> = {
  ALTA: "Alta",
  MEDIA: "Média",
  BAIXA: "Baixa",
};

export const CONFIANCA_BADGE_CLASS: Record<string, string> = {
  ALTA: "border-emerald-500/40 text-emerald-700",
  MEDIA: "border-amber-500/40 text-amber-700",
  BAIXA: "border-[var(--border)] text-[var(--text-muted)]",
};

export const TIPO_EVIDENCIA_MARCA_LABEL: Record<string, string> = {
  SITE_OFICIAL: "Site oficial",
  CATALOGO_PRODUTO: "Catálogo de produto",
  INSTAGRAM_COMERCIAL: "Instagram comercial",
  POST_PRODUTO: "Post de produto",
  FOTO_VITRINE: "Foto de vitrine",
  MARKETPLACE: "Marketplace",
  OUTRA_FONTE_VERIFICAVEL: "Outra fonte verificável",
};

export const CRITERIO_GATE_LABEL: Record<string, string> = {
  EXISTENCIA: "Existência verificável",
  ATIVIDADE_COMERCIAL: "Atividade comercial",
  VAREJO_VESTUARIO: "Varejo de vestuário",
  MODA_MASCULINA: "Moda masculina",
  MULTIMARCAS: "Multimarcas",
  POSICIONAMENTO_TVB: "Posicionamento TVB",
};

export const RESULTADO_CRITERIO_LABEL: Record<string, string> = {
  ATENDE: "Atende",
  NAO_ATENDE: "Não atende",
  INCONCLUSIVO: "Inconclusivo",
};

export const RESULTADO_ELIMINACAO_LABEL: Record<string, string> = {
  APROVADO_GATE: "Passou no gate obrigatório",
  REPROVADO: "Reprovado no gate obrigatório",
  INCONCLUSIVO: "Gate inconclusivo (falta evidência)",
};

// Estágio comercial = pipeline de contato/negociação (campo legado `status`), ortogonal à
// decisão do motor (`statusComercial`): um prospect pode estar APROVADO pelo motor e em qualquer
// etapa de contato aqui. Ver prospeccao-radar-console.tsx pra o mesmo mapa usado no pipeline manual.
export const ESTAGIO_COMERCIAL_LABEL: Record<string, string> = {
  NOVO: "Novo",
  EM_QUALIFICACAO: "Em qualificação",
  QUALIFICADO: "Qualificado",
  CONTATADO: "Contatado",
  NEGOCIACAO: "Em negociação",
  CONVERTIDO: "Convertido",
  DESCARTADO: "Descartado",
};
