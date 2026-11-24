import { describe, it, expect } from "vitest";
import { ordenarProdutos, parseSortKey, type SortKey } from "../produtos-table";
import type { ProdutoPlanejamento } from "@/lib/metrics";

// Zona 2 (Reformulação do Planejamento de Estoque, 2026-11-23) — "tabela enxuta e utilizável...
// com busca/filtro/ordenação/priorização". ordenarProdutos é pura (sem servidor/React) — testada
// aqui diretamente, mesma convenção de função pura do resto do projeto.

function produto(overrides: Partial<ProdutoPlanejamento> = {}): ProdutoPlanejamento {
  return {
    produto: "Produto X",
    grupo: "Grupo",
    classificacao: "NAO_CLASSIFICADO",
    cods: ["COD-1"],
    estoqueTotal: 0,
    estoqueCD: 0,
    estoqueLojas: 0,
    vendasDias30: 0,
    vendasDias60: 0,
    vendasDias90: 0,
    velocidadeDiaria: 0,
    coberturaDias: null,
    diasHistoricoDisponivel: 0,
    confiavel: false,
    situacao: "sem_dado",
    tendencia: "sem_dado",
    demandaPossivelmenteMascarada: false,
    quantidadeEmTransito: 0,
    transitoConfiavel: false,
    necessidadeReposicao: false,
    ...overrides,
  };
}

describe("parseSortKey", () => {
  it("aceita só as chaves válidas, nunca uma string arbitrária", () => {
    expect(parseSortKey("estoqueTotal")).toBe("estoqueTotal");
    expect(parseSortKey("qualquer-coisa")).toBe("produto");
    expect(parseSortKey("")).toBe("produto");
  });
});

describe("ordenarProdutos", () => {
  const linhas = [
    produto({ produto: "Zebra", estoqueTotal: 10, vendasDias90: 5, coberturaDias: 30, situacao: "equilibrado" }),
    produto({ produto: "Alfa", estoqueTotal: 100, vendasDias90: 0, coberturaDias: null, situacao: "ruptura" }),
    produto({ produto: "Beta", estoqueTotal: 50, vendasDias90: 20, coberturaDias: 5, situacao: "cobertura_critica" }),
  ];

  it("default (produto, asc) -> ordem alfabética pt-BR", () => {
    const r = ordenarProdutos(linhas, "produto", "asc");
    expect(r.map((p) => p.produto)).toEqual(["Alfa", "Beta", "Zebra"]);
  });

  it("produto, desc -> ordem alfabética invertida", () => {
    const r = ordenarProdutos(linhas, "produto", "desc");
    expect(r.map((p) => p.produto)).toEqual(["Zebra", "Beta", "Alfa"]);
  });

  it("estoqueTotal, asc/desc", () => {
    expect(ordenarProdutos(linhas, "estoqueTotal", "asc").map((p) => p.estoqueTotal)).toEqual([10, 50, 100]);
    expect(ordenarProdutos(linhas, "estoqueTotal", "desc").map((p) => p.estoqueTotal)).toEqual([100, 50, 10]);
  });

  it("vendasDias90, asc/desc", () => {
    expect(ordenarProdutos(linhas, "vendasDias90", "asc").map((p) => p.vendasDias90)).toEqual([0, 5, 20]);
    expect(ordenarProdutos(linhas, "vendasDias90", "desc").map((p) => p.vendasDias90)).toEqual([20, 5, 0]);
  });

  it("coberturaDias: null sempre por último, em qualquer direção", () => {
    const asc = ordenarProdutos(linhas, "coberturaDias", "asc");
    expect(asc[asc.length - 1].coberturaDias).toBeNull();
    const desc = ordenarProdutos(linhas, "coberturaDias", "desc");
    expect(desc[desc.length - 1].coberturaDias).toBeNull();
  });

  it("situacao: prioridade de leitura (ruptura/crítico primeiro), não ordem alfabética do rótulo", () => {
    const r = ordenarProdutos(linhas, "situacao", "asc");
    expect(r.map((p) => p.situacao)).toEqual(["ruptura", "cobertura_critica", "equilibrado"]);
  });

  it("nunca muta o array original", () => {
    const original = [...linhas];
    ordenarProdutos(linhas, "estoqueTotal", "desc");
    expect(linhas).toEqual(original);
  });

  it("chave inválida (vinda de query string adulterada) cai no default (produto, alfabético) em vez de quebrar", () => {
    const r = ordenarProdutos(linhas, "coisa-invalida" as SortKey, "asc");
    expect(r.map((p) => p.produto)).toEqual(["Alfa", "Beta", "Zebra"]);
  });
});
