import { describe, it, expect } from "vitest";
import { splitMelhoresPiores } from "../performance";

// Bug real corrigido em 2026-11-25: getPerfilDetalhe montava "melhores conteúdos" com
// comEngOrdenado.slice(0, 5) e "piores conteúdos" com comEngOrdenado.slice(-5).reverse() — pra
// qualquer N entre 6 e 9 (lista ordenada do maior pro menor engajamento), os índices dos dois
// slices se cruzavam e o MESMO conteúdo aparecia nas duas listas ao mesmo tempo. Esses testes
// cobrem N de 0 a 12+ e garantem que, depois da correção, nenhum item nunca aparece nos dois
// lados — usando objetos com id único por posição pra detectar qualquer sobreposição.
function gerarLista(n: number) {
  // Ordem decrescente de engajamento, já como getPerfilDetalhe produz em comEngOrdenado.
  return Array.from({ length: n }, (_, i) => ({ id: `item-${i}`, engajamento: n - i }));
}

function semSobreposicao(melhores: { id: string }[], piores: { id: string }[]) {
  const idsMelhores = new Set(melhores.map((m) => m.id));
  return piores.every((p) => !idsMelhores.has(p.id));
}

describe("splitMelhoresPiores", () => {
  it("N=0: ambas as listas vazias", () => {
    const { melhores, piores } = splitMelhoresPiores(gerarLista(0));
    expect(melhores).toEqual([]);
    expect(piores).toEqual([]);
  });

  for (const n of [1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 20]) {
    it(`N=${n}: nenhum conteúdo aparece em melhores E piores simultaneamente`, () => {
      const lista = gerarLista(n);
      const { melhores, piores } = splitMelhoresPiores(lista);
      expect(semSobreposicao(melhores, piores)).toBe(true);
      // Nenhum lado pode superar o total disponível nem o tamanho de 5.
      expect(melhores.length).toBeLessThanOrEqual(Math.min(5, n));
      expect(piores.length).toBeLessThanOrEqual(Math.min(5, n));
      // Nunca os dois lados somados excedem N (garante que não há overlap por contagem também).
      expect(melhores.length + piores.length).toBeLessThanOrEqual(n);
    });
  }

  it("N=6 a N=9 (faixa do bug original): reproduz o cenário que antes cruzava índices e confirma ausência de overlap", () => {
    for (const n of [6, 7, 8, 9]) {
      const lista = gerarLista(n);
      const { melhores, piores } = splitMelhoresPiores(lista);
      // Reprodução do bug antigo pra deixar claro o que estava errado: slice(0,5) e
      // slice(-5).reverse() cruzavam nesses tamanhos.
      const antigoMelhores = lista.slice(0, 5);
      const antigoPiores = lista.length > 5 ? lista.slice(-5).reverse() : [];
      expect(semSobreposicao(antigoMelhores, antigoPiores)).toBe(false); // confirma que o bug existia

      // E a versão corrigida não tem esse problema.
      expect(semSobreposicao(melhores, piores)).toBe(true);
    }
  });

  it("N=10: comportamento idêntico ao antigo (5 melhores + 5 piores, sem overlap, já era correto)", () => {
    const lista = gerarLista(10);
    const { melhores, piores } = splitMelhoresPiores(lista);
    expect(melhores.map((m) => m.id)).toEqual(lista.slice(0, 5).map((m) => m.id));
    expect(piores.map((p) => p.id)).toEqual(lista.slice(-5).reverse().map((m) => m.id));
  });

  it("N=7: cada lado fica com 3 (floor(7/2)), o item do meio (índice 3) não entra em nenhum lado", () => {
    const lista = gerarLista(7);
    const { melhores, piores } = splitMelhoresPiores(lista);
    expect(melhores.map((m) => m.id)).toEqual(["item-0", "item-1", "item-2"]);
    expect(piores.map((p) => p.id)).toEqual(["item-6", "item-5", "item-4"]);
  });

  it("N=1: lado vira 0 (floor(1/2)=0) — não há base suficiente pra separar melhor de pior", () => {
    const { melhores, piores } = splitMelhoresPiores(gerarLista(1));
    expect(melhores).toEqual([]);
    expect(piores).toEqual([]);
  });
});
