import { describe, it, expect } from "vitest";
import { agregarReposicaoBestSellerConsolidada, COLECAO_BEST_SELLER } from "../reposicao-bestseller-consolidada";

function stockRow(overrides: Partial<Parameters<typeof agregarReposicaoBestSellerConsolidada>[0][number]> = {}) {
  return {
    cod: "COD-1",
    produto: "Camisa Polo",
    grupo: "Polos",
    cor: "Azul",
    tamanho: "M",
    colecao: COLECAO_BEST_SELLER,
    quantidadeDisponivel: 0,
    ...overrides,
  };
}

describe("agregarReposicaoBestSellerConsolidada (pura)", () => {
  it("soma o disponível de TODAS as lojas/CD antes de comparar com o mínimo — falta em algumas lojas compensada por sobra em outra não deveria sumir, mas o TOTAL agregado decide", () => {
    const itens = agregarReposicaoBestSellerConsolidada(
      [
        stockRow({ cod: "COD-1", quantidadeDisponivel: 2 }), // loja A: quase nada
        stockRow({ cod: "COD-1", quantidadeDisponivel: 3 }), // loja B: pouco também
        stockRow({ cod: "COD-1", quantidadeDisponivel: 1 }), // CD/Site: quase nada
      ],
      new Map([["COD-1", 10]])
    );
    // total disponível = 6, mínimo = 10 -> falta real de 4, mesmo cada posição isolada parecendo pequena
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ cod: "COD-1", quantidadeDisponivel: 6, estoqueMinimo: 10, falta: 4 });
  });

  it("quando a soma agregada das lojas cobre o mínimo, não aparece falta mesmo com uma loja individual zerada", () => {
    const itens = agregarReposicaoBestSellerConsolidada(
      [
        stockRow({ cod: "COD-2", quantidadeDisponivel: 0 }), // loja A: zerada
        stockRow({ cod: "COD-2", quantidadeDisponivel: 20 }), // loja B: sobra grande compensa
      ],
      new Map([["COD-2", 10]])
    );
    expect(itens).toHaveLength(0);
  });

  it("SKU não-Best-Seller (colecao diferente de BESTSELLER) nunca aparece, mesmo com falta real", () => {
    const itens = agregarReposicaoBestSellerConsolidada(
      [stockRow({ cod: "COD-DROP", colecao: "V26.1", quantidadeDisponivel: 1 })],
      new Map([["COD-DROP", 100]])
    );
    expect(itens).toHaveLength(0);
  });

  // Achado real em 2026-11-24: os 141 SKUs Best Seller do Neon dev estavam TODOS sem mínimo
  // cadastrado — a versão anterior (excluía quem não tinha mínimo) deixava o painel sempre vazio,
  // sem nenhum ponto de partida pra cadastrar o primeiro valor. Agora aparece com falta=null (uma
  // chamada pra ação — "cadastre o mínimo" — distinta de "já sei que está em falta").
  it("SKU Best Seller sem EstoqueMinimoManual cadastrado aparece com falta=null (chamada pra cadastrar, não falta real)", () => {
    const itens = agregarReposicaoBestSellerConsolidada(
      [stockRow({ cod: "COD-SEM-MINIMO", quantidadeDisponivel: 0 })],
      new Map() // nenhum mínimo cadastrado pra nenhum cod
    );
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ cod: "COD-SEM-MINIMO", estoqueMinimo: null, falta: null });
  });

  it("cod com colecao divergente entre posições (achado real no Neon dev) ainda soma TODAS as posições, não só as rotuladas BESTSELLER", () => {
    const itens = agregarReposicaoBestSellerConsolidada(
      [
        stockRow({ cod: "COD-DIVERGENTE", colecao: COLECAO_BEST_SELLER, quantidadeDisponivel: 2 }),
        // mesma SKU, outra loja, veio com colecao diferente no sync (ruído de timing) — ainda
        // precisa contar pro total, senão o "Disponível" fica artificialmente baixo.
        stockRow({ cod: "COD-DIVERGENTE", colecao: "AV 27", quantidadeDisponivel: 5 }),
      ],
      new Map([["COD-DIVERGENTE", 10]])
    );
    expect(itens).toHaveLength(1);
    expect(itens[0].quantidadeDisponivel).toBe(7);
    expect(itens[0].falta).toBe(3);
  });

  it("falta é exatamente estoqueMinimo - quantidadeDisponivel, nunca negativa (filtro garante só falta real)", () => {
    const itens = agregarReposicaoBestSellerConsolidada([stockRow({ cod: "COD-3", quantidadeDisponivel: 4 })], new Map([["COD-3", 9]]));
    expect(itens[0].falta).toBe(5);
    expect(itens.every((i) => i.falta == null || i.falta > 0)).toBe(true);
  });

  it("ordena por maior falta primeiro, depois produto alfabético em caso de empate", () => {
    const itens = agregarReposicaoBestSellerConsolidada(
      [
        stockRow({ cod: "COD-B", produto: "Bermuda", quantidadeDisponivel: 0 }),
        stockRow({ cod: "COD-A", produto: "Camisa", quantidadeDisponivel: 8 }),
        stockRow({ cod: "COD-C", produto: "Short", quantidadeDisponivel: 5 }),
      ],
      new Map([
        ["COD-B", 10], // falta 10
        ["COD-A", 10], // falta 2
        ["COD-C", 15], // falta 10 (empate com COD-B, decide por produto)
      ])
    );
    expect(itens.map((i) => i.cod)).toEqual(["COD-B", "COD-C", "COD-A"]);
  });

  it("lista de estoque vazia devolve lista vazia", () => {
    expect(agregarReposicaoBestSellerConsolidada([], new Map())).toEqual([]);
  });

  it("mantém cor/tamanho/produto/grupo da primeira posição vista pro cod", () => {
    const itens = agregarReposicaoBestSellerConsolidada(
      [stockRow({ cod: "COD-4", produto: "Vestido", grupo: "Vestidos", cor: "Preto", tamanho: "P", quantidadeDisponivel: 1 })],
      new Map([["COD-4", 5]])
    );
    expect(itens[0]).toMatchObject({ produto: "Vestido", grupo: "Vestidos", cor: "Preto", tamanho: "P" });
  });

  // Edição inline do mínimo direto no card (pedido do Rodrigo, 2026-11-24: "editar o mínimo direto
  // ali, sem trocar de aba") — MinimoManualForm (reaproveitado de estoque-minimo-manual/forms.tsx)
  // só usa velocidadeDiariaConsolidada pro texto de ajuda (sugestão), nunca pra decidir falta.
  it("velocidadeDiariaConsolidada vem do mapa passado, default 0 quando não informado (retrocompatível)", () => {
    const comVelocidade = agregarReposicaoBestSellerConsolidada(
      [stockRow({ cod: "COD-5", quantidadeDisponivel: 1 })],
      new Map([["COD-5", 10]]),
      new Map([["COD-5", 2.5]])
    );
    expect(comVelocidade[0]).toMatchObject({ velocidadeDiariaConsolidada: 2.5 });

    const semVelocidade = agregarReposicaoBestSellerConsolidada(
      [stockRow({ cod: "COD-6", quantidadeDisponivel: 1 })],
      new Map([["COD-6", 10]])
    );
    expect(semVelocidade[0]).toMatchObject({ velocidadeDiariaConsolidada: 0 });
  });

  it("itens sem mínimo definido (falta=null) sempre vêm DEPOIS de toda falta real, mesmo que o produto venha antes alfabeticamente", () => {
    const itens = agregarReposicaoBestSellerConsolidada(
      [
        stockRow({ cod: "COD-AAA-SEM-MINIMO", produto: "AAA Sem Mínimo", quantidadeDisponivel: 0 }),
        stockRow({ cod: "COD-ZZZ-COM-FALTA", produto: "ZZZ Com Falta", quantidadeDisponivel: 1 }),
      ],
      new Map([["COD-ZZZ-COM-FALTA", 10]]) // só este tem mínimo cadastrado
    );
    expect(itens.map((i) => i.cod)).toEqual(["COD-ZZZ-COM-FALTA", "COD-AAA-SEM-MINIMO"]);
  });

  it("dentro do grupo 'sem mínimo definido', ordena por produto alfabético", () => {
    const itens = agregarReposicaoBestSellerConsolidada(
      [
        stockRow({ cod: "COD-B", produto: "Bermuda", quantidadeDisponivel: 0 }),
        stockRow({ cod: "COD-A", produto: "Alpargata", quantidadeDisponivel: 0 }),
      ],
      new Map() // nenhum tem mínimo
    );
    expect(itens.map((i) => i.cod)).toEqual(["COD-A", "COD-B"]);
  });
});
