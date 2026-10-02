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
