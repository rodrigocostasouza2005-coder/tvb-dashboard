import type { MetaInsight } from "@/lib/connectors/meta-ads";

export type CampanhaRow = { nome: string } & MetaInsight;

// Histórico (tudo no mesmo dia, 2026-11-06): PR #56 mostrava ativo+pausado juntos, só com selo.
// PR #58 trocou isso por um FILTRO de verdade (campanhasAtivasPorGasto, removida nesta revisão —
// ver abaixo). Rodrigo testou o filtro e voltou atrás: "os criativos voltaram mas eu não consigo
// saber quais estão ativos ou não" — escolheu explicitamente voltar ao comportamento do PR #56
// (mostrar todos, com selo), não ficar com o filtro silencioso. A seleção de linhas (top-15 por
// gasto) volta a ser pura, sem nenhuma participação do status — este arquivo só decide quando
// avisar que o SELO está indisponível, não mais quem aparece na tabela.
//
// campanhasAtivasPorGasto (filtrava por status antes do corte por gasto) foi removida: ficou sem
// nenhum chamador depois que a seleção de linhas voltou a ser por gasto puro. Se precisar dela de
// novo, está em ad85617 (PR #58).

// Seleção de linhas das tabelas "Por conjunto"/"Por anúncio": puro top-N por investimento, sem
// olhar status ativo/pausado — exatamente o comportamento de antes do PR #58 (e o que Rodrigo
// confirmou querer de volta). Status entra só depois, como selo visual (ver ativoPorNome em
// CampanhaTable), nunca como corte. Extraída aqui (em vez de ficar só dentro de page.tsx) pra dar
// pra testar sem renderizar o Server Component.
export function mapInsights(map: Map<string, MetaInsight>, limit: number): CampanhaRow[] {
  return [...map.entries()]
    .map(([nome, insight]) => ({ nome, ...insight }))
    .filter((r) => r.gasto > 0)
    .sort((a, b) => b.gasto - a.gasto)
    .slice(0, limit);
}

// Decide se a página deve mostrar o aviso "não deu pra confirmar o status ativo/pausado agora"
// acima das tabelas de Campanhas. Só dispara quando o Meta Ads em si respondeu (erroMetaAds null
// — esse erro mais grave já tem a própria mensagem, não precisa duplicar) MAS a busca de status
// falhou pra pelo menos uma das duas tabelas (undefined). Importante: isso NUNCA significa que a
// tabela está incompleta ou escondendo algo — a seleção de linhas (top-15 por gasto) não depende
// do status; só o selo Ativo/Pausado por linha fica indisponível (CampanhaTable já trata
// `ativoPorNome === undefined` caindo pra "sem selo", nunca "trata tudo como pausado"). Extraído
// como função pura pra não depender de renderizar o Server Component em teste.
export function statusAtivoIndisponivel(
  erroMetaAds: string | null,
  ativoPorConjunto: Map<string, boolean> | undefined,
  ativoPorAnuncio: Map<string, boolean> | undefined
): boolean {
  return erroMetaAds == null && (ativoPorConjunto === undefined || ativoPorAnuncio === undefined);
}
