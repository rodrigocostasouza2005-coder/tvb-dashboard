import { describe, it, expect } from "vitest";
import { parseProdutoAba, hrefComProdutoAba, PRODUTO_ABAS } from "../produto-aba-nav";

// Zona 3 (Reformulação do Planejamento de Estoque, 2026-11-23) — navegação por abas via
// searchParam `aba`, mesmo padrão de distribuicao-estoque/aba-nav.tsx. Testado aqui como função
// pura (sem servidor/React), garantindo: (1) nunca aceita um valor de aba arbitrário vindo da URL,
// (2) sempre preserva os outros parâmetros (grupo/tamanho/busca/produto/situacao/sort/dir) ao
// trocar de aba — é assim que "manter seleção de produto e filtros ao navegar entre abas" é
// garantido.
describe("parseProdutoAba", () => {
  it("todas as 5 abas do pedido existem", () => {
    expect(PRODUTO_ABAS.map((a) => a.value)).toEqual(["geral", "grade", "distribuicao", "reposicao", "decisoes"]);
  });

  it("aceita só valores válidos, cai em 'geral' pra qualquer outra coisa (inclusive adulteração de URL)", () => {
    expect(parseProdutoAba("grade")).toBe("grade");
    expect(parseProdutoAba("decisoes")).toBe("decisoes");
    expect(parseProdutoAba("qualquer-coisa")).toBe("geral");
    expect(parseProdutoAba(undefined)).toBe("geral");
    expect(parseProdutoAba(["grade", "decisoes"])).toBe("geral"); // array não é um valor de aba válido
  });
});

describe("hrefComProdutoAba", () => {
  it("preserva produto/grupo/tamanho/busca/situacao/sort/dir ao trocar de aba", () => {
    const href = hrefComProdutoAba("/dashboard/planejamento-estoque", {
      produto: "Classic Black",
      grupo: ["Camisetas", "Polos"],
      busca: "preto",
      situacao: "risco",
      sort: "coberturaDias",
      dir: "desc",
      aba: "geral", // deve ser substituído, nunca duplicado
    }, "reposicao");

    const qs = new URLSearchParams(href.split("?")[1]);
    expect(qs.get("produto")).toBe("Classic Black");
    expect(qs.getAll("grupo")).toEqual(["Camisetas", "Polos"]);
    expect(qs.get("busca")).toBe("preto");
    expect(qs.get("situacao")).toBe("risco");
    expect(qs.get("sort")).toBe("coberturaDias");
    expect(qs.get("dir")).toBe("desc");
    expect(qs.get("aba")).toBe("reposicao");
  });

  it("sem nenhum outro parâmetro, só seta aba", () => {
    const href = hrefComProdutoAba("/dashboard/planejamento-estoque", {}, "decisoes");
    expect(href).toBe("/dashboard/planejamento-estoque?aba=decisoes");
  });
});
