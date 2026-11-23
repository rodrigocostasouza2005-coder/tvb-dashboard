// Lógica de consolidação usada pela migração de grão de ClassificacaoProduto (cod ->
// produto+cor, 2026-11-19/23 — ver comentário completo em prisma/schema.prisma e em
// scripts/backfill-classificacao-produto-cor.ts, que é quem de fato lê/escreve no banco).
//
// Extraída como função PURA (sem Prisma) de propósito: é a peça de maior risco de toda a
// migração — resolve conflito quando dois (ou mais) `cod`s do MESMO produto+cor foram
// classificados diferente no passado (só podia acontecer porque o grão antigo era por cod) — e
// precisa de confiança total antes de rodar contra dado real, que só um teste determinístico dá.
//
// Regra de resolução escolhida: a linha com `updatedAt` mais recente vence a linha INTEIRA (não
// um merge campo a campo) — representa a decisão mais recente que uma pessoa tomou sobre aquele
// produto+cor, e tratar a edição mais nova como a que prevalece é a mesma lógica de "a última
// decisão humana é a válida" já usada em upsertClassificacaoProduto (histórico registra quem
// mudou o quê, mas o valor atual sempre reflete a gravação mais recente). Empate de updatedAt
// (teoricamente raro) usa createdAt como critério seguinte, e por fim o id (determinístico,
// nunca aleatório) — nunca escolhe a linha "maior" por acaso.
//
// IMPORTANTE: cores DIFERENTES do mesmo produto NUNCA entram no mesmo grupo (chave inclui a cor)
// — só tamanhos da MESMA cor (que têm cods diferentes mas deveriam sempre ter tido a mesma
// classificação) são candidatos a conflito aqui.

export type LinhaClassificacaoAntiga = {
  id: string;
  cod: string;
  produto: string;
  grupo: string;
  colecao: string | null;
  tipoCompra: string;
  statusComercial: string;
  possibilidadeReposicao: string;
  dataLancamento: string | null; // ISO, ou null
  dataEncerramentoPrevista: string | null;
  orcamentoDrop: number | null;
  observacoes: string | null;
  createdAt: string;
  updatedAt: string;
};

// Campos de NEGÓCIO comparados pra decidir se um grupo produto+cor realmente "conflita" (valores
// diferentes entre os cods que foram agrupados) ou é só duplicata inofensiva (mesmo valor
// repetido em vários tamanhos, o caso normal quando classificarProdutoEmLoteAction já tinha sido
// usado antes desta migração). `grupo` não entra aqui: é resolvido pela fonte real
// (Sale/StockSnapshot), não é uma decisão humana que possa "conflitar".
const CAMPOS_COMPARAVEIS = [
  "tipoCompra",
  "statusComercial",
  "possibilidadeReposicao",
  "colecao",
  "orcamentoDrop",
  "observacoes",
  "dataLancamento",
  "dataEncerramentoPrevista",
] as const satisfies readonly (keyof LinhaClassificacaoAntiga)[];

export type GrupoClassificacaoResolvido = {
  produtoCor: string;
  linhas: LinhaClassificacaoAntiga[];
  vencedora: LinhaClassificacaoAntiga;
  perdedoras: LinhaClassificacaoAntiga[];
  // true = pelo menos 1 campo de negócio diverge entre as linhas do grupo — conflito REAL que
  // existia só porque o grão antigo (por cod) permitia tamanhos da mesma cor discordarem.
  conflita: boolean;
  camposDivergentes: string[];
};

function normalizar(v: unknown): string {
  return v == null ? "" : String(v);
}

// Decide a vencedora de um grupo (mesma produto+cor) e se há conflito real. Nunca lança pra
// grupo vazio (bug de quem chama) nem adivinha nada — compara exatamente os campos listados.
export function resolverGrupoClassificacao(
  produtoCor: string,
  linhas: LinhaClassificacaoAntiga[]
): GrupoClassificacaoResolvido {
  if (linhas.length === 0) {
    throw new Error(`resolverGrupoClassificacao chamado com grupo vazio (${produtoCor})`);
  }
  const ordenadas = [...linhas].sort((a, b) => {
    const porUpdated = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    if (porUpdated !== 0) return porUpdated;
    const porCreated = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (porCreated !== 0) return porCreated;
    return a.id.localeCompare(b.id);
  });
  const vencedora = ordenadas[0];
  const perdedoras = ordenadas.slice(1);

  const camposDivergentes = CAMPOS_COMPARAVEIS.filter(
    (campo) => new Set(linhas.map((l) => normalizar(l[campo]))).size > 1
  );

  return { produtoCor, linhas, vencedora, perdedoras, conflita: camposDivergentes.length > 0, camposDivergentes };
}

export type ResultadoAgrupamento = {
  grupos: GrupoClassificacaoResolvido[];
  // Linhas cujo `cod` não apareceu em NENHUMA fonte real (Sale/StockSnapshot) — não há como saber
  // a cor real, então NUNCA são consolidadas por adivinhação. Ficam de fora do resultado pra quem
  // chama decidir manualmente (nunca silenciosamente descartadas).
  semBaseReal: LinhaClassificacaoAntiga[];
};

// Agrupa as linhas antigas (por cod) em grupos produto+cor, usando `corPorCod` já resolvida pelo
// chamador (fonte real: Sale/StockSnapshot) — função pura, não faz I/O.
export function agruparEResolverClassificacoes(
  linhas: LinhaClassificacaoAntiga[],
  corPorCod: Map<string, string>
): ResultadoAgrupamento {
  const semBaseReal: LinhaClassificacaoAntiga[] = [];
  const porChave = new Map<string, LinhaClassificacaoAntiga[]>();
  for (const l of linhas) {
    const cor = corPorCod.get(l.cod);
    if (cor == null) {
      semBaseReal.push(l);
      continue;
    }
    const chave = `${l.produto}::${cor}`;
    const arr = porChave.get(chave) ?? [];
    arr.push(l);
    porChave.set(chave, arr);
  }
  const grupos = [...porChave.entries()].map(([chave, ls]) => resolverGrupoClassificacao(chave, ls));
  return { grupos, semBaseReal };
}
