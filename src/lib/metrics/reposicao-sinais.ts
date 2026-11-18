import type { MovimentacaoRecomendada } from "./distribuicao-estoque";
import type { ItemMinimoManual } from "./estoque-minimo-manual";

// Camada 100% aditiva usada pela tela de Reposição de lojas (reposicao/page.tsx) pra cruzar, por
// SKU+loja já mostrado na tabela, com dois sinais que já existem em outros motores — nunca
// recalcula nada do que já é mostrado (quantidadeDisponivel/falta/estoqueMinimo/origemSugerida de
// getReplenishment/getReplenishmentPorVendas em estoque.ts continuam exatamente como estavam):
//
// 1) O mínimo MANUAL por SKU (getEstoqueMinimoManual, estoque-minimo-manual.ts) — vale pra
//    QUALQUER cod, classificado ou não, soma de todas as posições da empresa.
// 2) Oportunidade de transferência já sugerida pelo motor de Distribuição
//    (getMovimentacoesRecomendadas, distribuicao-estoque.ts) pro MESMO cod e MESMA loja de
//    destino — nunca agregada por produto (ver docs/planejamento-inteligente-estoque.md §17.2:
//    agregar por produto pode somar excesso de um tamanho com ruptura de outro tamanho do mesmo
//    produto, que o motor real corretamente não casa). Casando por cod + storeId exatos, no
//    mesmo grão que o motor usa internamente, essa armadilha nunca acontece aqui.
//
// Ambas as funções abaixo são PURAS (sem Prisma) — mesmo padrão de diagnosticarVariante/
// vendasEfetivasCdSite (distribuicao-estoque.ts): recebem o resultado já calculado por outra
// camada e só organizam/casam por chave, testáveis com dado sintético.

export type SinalTransferencia = {
  quantidade: number;
  // Nomes distintos das posições de origem, na ordem em que apareceram.
  origens: string[];
};

// Só guarda cods com minimoDefinido != null — o pedido do Rodrigo é mostrar o nível de alerta do
// mínimo manual "quando houver um definido"; cod sem mínimo manual (SEM_MINIMO_DEFINIDO) não entra
// no mapa, então o lookup na UI (map.get(cod)) já devolve undefined pra ele sem precisar checar o
// nível em outro lugar.
export function construirMapaMinimoManualPorCod(itens: ItemMinimoManual[]): Map<string, ItemMinimoManual> {
  const mapa = new Map<string, ItemMinimoManual>();
  for (const item of itens) {
    if (item.minimoDefinido != null) mapa.set(item.cod, item);
  }
  return mapa;
}

// Chave do mapa: `${destinoPosicaoId}::${cod}` — exatamente o grão de uma linha da tela de
// Reposição (1 loja + 1 SKU). Soma quantidadeSugerida de todas as oportunidades que batem nessa
// chave (pode ter mais de uma origem pro mesmo destino) e coleta os nomes de origem distintos.
// Oportunidade com quantidadeSugerida <= 0 nunca deveria existir no motor, mas a guarda aqui é
// defensiva (nunca mostra "transferência disponível" de 0 unidades).
export function construirMapaTransferenciaPorCodELoja(
  movimentacoes: Pick<MovimentacaoRecomendada, "cod" | "destinoPosicaoId" | "origemNome" | "quantidadeSugerida">[]
): Map<string, SinalTransferencia> {
  const mapa = new Map<string, SinalTransferencia>();
  for (const m of movimentacoes) {
    if (m.quantidadeSugerida <= 0) continue;
    const chave = `${m.destinoPosicaoId}::${m.cod}`;
    const atual = mapa.get(chave) ?? { quantidade: 0, origens: [] };
    atual.quantidade += m.quantidadeSugerida;
    if (!atual.origens.includes(m.origemNome)) atual.origens.push(m.origemNome);
    mapa.set(chave, atual);
  }
  return mapa;
}
