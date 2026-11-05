// Lógica pura de "qual foto mostrar como thumb da tabela Por Anúncio" — extraída pra ser
// testável sem DOM/React, mesmo padrão de função pura de montarVendasPorCanal em black-friday.ts.
// getFotosPorNomeAnuncio (meta-ads.ts) pode devolver 0, 1 ou várias fotos por anúncio; aqui só
// decide qual é a thumb principal e quantas sobram pro badge "+N" — nunca busca/formata URL.
export type ThumbSelecionado = { thumb: string | undefined; extras: number };

export function selecionarThumb(fotos: string[] | undefined): ThumbSelecionado {
  if (!fotos || fotos.length === 0) return { thumb: undefined, extras: 0 };
  return { thumb: fotos[0], extras: fotos.length - 1 };
}
