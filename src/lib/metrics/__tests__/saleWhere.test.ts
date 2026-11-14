import { describe, it, expect } from "vitest";
import { saleWhere, returnWhere } from "../core";

const baseFilters = {
  from: new Date("2026-01-01"),
  to: new Date("2026-01-31"),
  storeIds: undefined,
  marcas: undefined,
  tabelasPreco: undefined,
  grupoIn: undefined,
  tamanhoIn: undefined,
  colecaoIn: undefined,
};

describe("saleWhere — regra central de venda válida", () => {
  it("sempre exclui venda cancelada, independente dos outros filtros", () => {
    const where = saleWhere(baseFilters);
    expect(where.status).toEqual({ not: "Cancelada" });
  });

  it("continua excluindo cancelada mesmo com filtros de loja/marca/coleção ativos", () => {
    const where = saleWhere({
      ...baseFilters,
      storeIds: ["loja-1"],
      marcas: ["TVBSHORTS"],
      colecaoIn: ["BESTSELLER"],
    });
    expect(where.status).toEqual({ not: "Cancelada" });
    expect(where.storeId).toEqual({ in: ["loja-1"] });
  });
});

describe("returnWhere — mesma regra pra devolução", () => {
  it("sempre exclui devolução cancelada", () => {
    const where = returnWhere(baseFilters);
    expect(where.status).toEqual({ not: "Cancelada" });
  });
});

// Achado em 2026-11-14 (Rodrigo viu Barra/Leblon/Rio Sul negativas no "Comparativo entre
// lojas" em 10/11): marca: { in: filters.marcas } sem passthrough de null excluía toda venda
// com marca ainda não inferida (sync grava `item.Marca ?? null`), enquanto a devolução
// correspondente nunca é filtrada por marca (returnWhere() não tem esse campo) — líquido saía
// negativo sem nenhum dado corrompido. tabelaPreco já tinha esse passthrough; marca nunca tinha
// ganhado o mesmo tratamento.
describe("saleWhere — marca precisa incluir null (mesmo tratamento de tabelaPreco)", () => {
  it("sem filtro de marca, não restringe por marca nenhuma (comportamento antigo preservado)", () => {
    const where = saleWhere(baseFilters);
    expect(where.AND).toBeUndefined();
  });

  it("com filtro de marca, inclui um OR que aceita a marca filtrada OU null", () => {
    const where = saleWhere({ ...baseFilters, marcas: ["TVBSHORTS"] });
    expect(where.AND).toContainEqual({ OR: [{ marca: { in: ["TVBSHORTS"] } }, { marca: null }] });
  });

  it("com filtro de marca E tabelaPreco juntos, nenhum OR sobrescreve o outro", () => {
    const where = saleWhere({ ...baseFilters, marcas: ["TVBSHORTS"], tabelasPreco: ["Tabela varejo"] });
    expect(where.AND).toContainEqual({ OR: [{ marca: { in: ["TVBSHORTS"] } }, { marca: null }] });
    expect(where.AND).toContainEqual({
      OR: [{ tabelaPreco: { in: ["Tabela varejo"] } }, { tabelaPreco: null }],
    });
    expect((where.AND as unknown[]).length).toBe(2);
  });
});
