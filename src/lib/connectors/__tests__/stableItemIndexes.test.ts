import { describe, it, expect } from "vitest";
import { stableItemIndexes } from "../dapic";

// Regressão direta do bug que quebrou scripts/backfill-return-colecao.ts (versão anterior usava
// item.Id da API, que a própria DAPIC confirmou NÃO ser estável ao longo do tempo — ver
// comentário em dapic.ts). O itemIndex gravado no banco é o devolvido por esta função, calculado
// só pelo CONTEÚDO do item (cod/qtd/valor/tipo), nunca pelo Id bruto da API.
describe("stableItemIndexes", () => {
  it("é determinístico: mesma lista de itens sempre gera os mesmos índices", () => {
    const itens = [
      { cod: "100", qtd: 1, valor: 297, tipo: "Venda" },
      { cod: "200", qtd: 1, valor: 159, tipo: "Devolução" },
    ];
    const key = (i: (typeof itens)[number]) => `${i.cod}::${i.qtd}::${i.valor.toFixed(2)}::${i.tipo}`;
    const a = stableItemIndexes(itens, key);
    const b = stableItemIndexes(itens, key);
    expect(a).toEqual(b);
  });

  it("é insensível à ordem de chegada dos itens da API (reordenar não muda o índice de cada um)", () => {
    const itens = [
      { cod: "100", qtd: 1, valor: 297, tipo: "Venda" },
      { cod: "200", qtd: 1, valor: 159, tipo: "Devolução" },
      { cod: "50", qtd: 2, valor: 89, tipo: "Brinde" },
    ];
    const key = (i: (typeof itens)[number]) => `${i.cod}::${i.qtd}::${i.valor.toFixed(2)}::${i.tipo}`;
    const indicesOriginal = stableItemIndexes(itens, key);
    const indiceDoItem200 = indicesOriginal[1];

    const itensReordenados = [itens[2], itens[0], itens[1]];
    const indicesReordenados = stableItemIndexes(itensReordenados, key);
    // item "200" agora está na posição 2 do array reordenado
    expect(indicesReordenados[2]).toBe(indiceDoItem200);
  });

  it("NÃO depende de um Id externo instável — só do conteúdo (cod/qtd/valor/tipo)", () => {
    // Mesmo item, "Id" da API diferente entre duas consultas (como a DAPIC faz de verdade) ->
    // o índice estável tem que ser o mesmo, já que o conteúdo relevante não mudou.
    const itemV1 = { apiId: 111, cod: "100", qtd: 1, valor: 297, tipo: "Devolução" };
    const itemV2 = { apiId: 999, cod: "100", qtd: 1, valor: 297, tipo: "Devolução" };
    const key = (i: { cod: string; qtd: number; valor: number; tipo: string }) =>
      `${i.cod}::${i.qtd}::${i.valor.toFixed(2)}::${i.tipo}`;
    expect(stableItemIndexes([itemV1], key)).toEqual(stableItemIndexes([itemV2], key));
  });
});
