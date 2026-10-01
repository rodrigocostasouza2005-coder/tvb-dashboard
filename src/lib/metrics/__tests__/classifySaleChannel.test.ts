import { describe, it, expect } from "vitest";
import { classifySaleChannel } from "../core";

describe("classifySaleChannel", () => {
  it("venda explicitamente B2B (tabelaPreco = Tabela atacado)", () => {
    const r = classifySaleChannel("Tabela atacado", "QUALQUER CLIENTE", new Set());
    expect(r).toEqual({ channel: "B2B", source: "TABELA_PRECO" });
  });

  it("venda explicitamente B2C (tabelaPreco = Tabela varejo)", () => {
    const r = classifySaleChannel("Tabela varejo", null, new Set());
    expect(r).toEqual({ channel: "B2C", source: "TABELA_PRECO" });
  });

  it("venda explicitamente B2C com outra tabela real (promoção, transferência etc)", () => {
    const r = classifySaleChannel("Promoção", null, new Set());
    expect(r).toEqual({ channel: "B2C", source: "TABELA_PRECO" });
  });

  it("sem tabela de preço, mas cliente com histórico confirmado de B2B", () => {
    const b2b = new Set(["NITHI COMERCIO DE ROUPAS LTDA"]);
    const r = classifySaleChannel(null, "NITHI COMERCIO DE ROUPAS LTDA", b2b);
    expect(r).toEqual({ channel: "B2B", source: "HISTORICO_CLIENTE" });
  });

  it("sem tabela de preço e cliente sem nenhum sinal de B2B (caso ambíguo) -> DESCONHECIDO, não B2C", () => {
    const r = classifySaleChannel(null, "Cliente Qualquer", new Set(["OUTRO CLIENTE LTDA"]));
    expect(r).toEqual({ channel: "DESCONHECIDO", source: "DESCONHECIDO" });
  });

  it("sem tabela de preço e sem cliente (venda balcão/anônima) -> DESCONHECIDO", () => {
    const r = classifySaleChannel(null, null, new Set(["ALGUM LTDA"]));
    expect(r).toEqual({ channel: "DESCONHECIDO", source: "DESCONHECIDO" });
  });

  it("tabelaPreco explícita nunca é sobrescrita pelo histórico do cliente (B2B que também compra varejo)", () => {
    const b2b = new Set(["CLIENTE ATACADO HABITUAL"]);
    const r = classifySaleChannel("Tabela varejo", "CLIENTE ATACADO HABITUAL", b2b);
    expect(r).toEqual({ channel: "B2C", source: "TABELA_PRECO" });
  });
});
