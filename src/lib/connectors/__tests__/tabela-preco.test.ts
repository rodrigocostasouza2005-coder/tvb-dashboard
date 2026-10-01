import { describe, it, expect } from "vitest";
import { inferTabelaPreco, type PriceCatalog } from "../tabela-preco";

function catalogoDeExemplo(): PriceCatalog {
  return new Map([
    ["100", [{ table: "Tabela varejo", valor: 297 }, { table: "Tabela atacado", valor: 178 }]],
    ["200", [{ table: "Tabela varejo", valor: 159 }]],
  ]);
}

describe("inferTabelaPreco", () => {
  it("bate exato com Tabela varejo", () => {
    expect(inferTabelaPreco("100", 297, catalogoDeExemplo())).toBe("Tabela varejo");
  });

  it("bate exato com Tabela atacado", () => {
    expect(inferTabelaPreco("100", 178, catalogoDeExemplo())).toBe("Tabela atacado");
  });

  it("dentro da tolerância de R$1 ainda bate", () => {
    expect(inferTabelaPreco("100", 297.5, catalogoDeExemplo())).toBe("Tabela varejo");
  });

  it("preço negociado fora de qualquer tolerância -> null (não arrisca chute errado)", () => {
    expect(inferTabelaPreco("100", 250, catalogoDeExemplo())).toBeNull();
  });

  it("cod sem nenhuma entrada no catálogo -> null", () => {
    expect(inferTabelaPreco("999", 297, catalogoDeExemplo())).toBeNull();
  });

  it("escolhe a tabela mais próxima quando mais de uma está dentro da tolerância", () => {
    const catalogo: PriceCatalog = new Map([
      ["100", [{ table: "Tabela varejo", valor: 297 }, { table: "Tabela atacado", valor: 200 }]],
    ]);
    expect(inferTabelaPreco("100", 200.5, catalogo)).toBe("Tabela atacado");
  });
});
