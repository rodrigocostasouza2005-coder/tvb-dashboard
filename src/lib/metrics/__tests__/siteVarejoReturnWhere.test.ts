import { describe, it, expect } from "vitest";
import { siteVarejoReturnWhere } from "../vendas";

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

describe("siteVarejoReturnWhere — devolução líquida do mapa Site", () => {
  it("restringe à loja CD informada", () => {
    const where = siteVarejoReturnWhere(baseFilters, "cd-store-id");
    expect(where.storeId).toBe("cd-store-id");
  });

  it("sem tabelasPreco, não filtra por tabela (mesmo comportamento de saleWhere)", () => {
    const where = siteVarejoReturnWhere(baseFilters, "cd-store-id");
    expect(where.OR).toBeUndefined();
  });

  it("com tabelasPreco, inclui as tabelas permitidas OU nulo — nunca deixa nulo de fora", () => {
    const where = siteVarejoReturnWhere({ ...baseFilters, tabelasPreco: ["Tabela varejo", "Promoção"] }, "cd-store-id");
    expect(where.OR).toEqual([{ tabelaPreco: { in: ["Tabela varejo", "Promoção"] } }, { tabelaPreco: null }]);
  });

  it("nunca inclui Tabela atacado quando a lista de permissão já veio sem ela", () => {
    // allowedTabelasPreco já chega sem "Tabela atacado" (getTabelaPrecoRestrictionSemAtacado) —
    // essa função só repassa a lista, não deve reintroduzi-la.
    const where = siteVarejoReturnWhere({ ...baseFilters, tabelasPreco: ["Tabela varejo"] }, "cd-store-id");
    const inList = (where.OR as Array<{ tabelaPreco?: { in: string[] } }>)[0].tabelaPreco?.in;
    expect(inList).not.toContain("Tabela atacado");
  });
});
