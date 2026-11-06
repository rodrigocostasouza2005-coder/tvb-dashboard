import type { MetaInsight } from "@/lib/connectors/meta-ads";

export type CampanhaRow = { nome: string } & MetaInsight;

// Pedido do Rodrigo em 2026-11-06: "eu quero que só mostre os criativos ativos" — a Central Black
// Friday não deve mais só SINALIZAR ativo/pausado (selo da versão anterior), tem que FILTRAR os
// pausados fora da tabela de verdade.
//
// Armadilha de ordem: se o filtro de "está ativo" rodar DEPOIS do corte de top-N por gasto, dois
// bugs acontecem: (1) um conjunto/anúncio pausado que ficou no top-N-por-gasto some da tabela sem
// ser substituído, a tabela encolhe pra menos de N linhas; (2) um ativo de verdade, rodando agora,
// que ficou de fora do top-N-por-gasto (ex.: #16 quando N=15) nunca tem chance de aparecer, mesmo
// sendo mais relevante pro Rodrigo agora do que um pausado que só gastou mais no passado. Por
// isso esta função filtra por status PRIMEIRO, e só corta pro top-N por gasto DEPOIS, sobre o
// conjunto já filtrado — garante até N linhas, todas ativas, sempre as de maior gasto ENTRE as
// ativas.
//
// `ativoPorNome === undefined` significa "não consegui confirmar quem está ativo agora" (token do
// Meta vencido, rate limit — ver try/catch em page.tsx). Fail OPEN aqui: não filtra nada, devolve
// o top-N por gasto normal, sem considerar status — equivalente ao comportamento de antes desta
// feature existir (mostrar tudo, inclusive pausado, é melhor do que uma tabela vazia). A página é
// responsável por mostrar um aviso visual nesse caso, já que a tabela deixa de garantir "só
// ativos".
export function campanhasAtivasPorGasto(
  map: Map<string, MetaInsight>,
  ativoPorNome: Map<string, boolean> | undefined,
  limit: number
): CampanhaRow[] {
  const entradas = [...map.entries()].map(([nome, insight]) => ({ nome, ...insight }));
  const comStatusResolvido = ativoPorNome ? entradas.filter((r) => ativoPorNome.get(r.nome) === true) : entradas;
  return comStatusResolvido
    .filter((r) => r.gasto > 0)
    .sort((a, b) => b.gasto - a.gasto)
    .slice(0, limit);
}

// Decide se a página deve mostrar o aviso "não deu pra confirmar quem está ativo, mostrando
// tudo" acima das tabelas de Campanhas. Só dispara quando o Meta Ads em si respondeu (erroMetaAds
// null — esse erro mais grave já tem a própria mensagem, não precisa duplicar) MAS a busca de
// status falhou pra pelo menos uma das duas tabelas (undefined). Extraído como função pura pra
// não depender de renderizar o Server Component em teste.
export function statusAtivoIndisponivel(
  erroMetaAds: string | null,
  ativoPorConjunto: Map<string, boolean> | undefined,
  ativoPorAnuncio: Map<string, boolean> | undefined
): boolean {
  return erroMetaAds == null && (ativoPorConjunto === undefined || ativoPorAnuncio === undefined);
}
