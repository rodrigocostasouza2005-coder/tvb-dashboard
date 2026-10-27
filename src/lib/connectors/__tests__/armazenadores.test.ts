import { describe, expect, it } from "vitest";
import { sellsProducts } from "../armazenadores";

describe("sellsProducts", () => {
  it("trata CD e ATACADO como loja de venda", () => {
    expect(sellsProducts("CD")).toBe(true);
    expect(sellsProducts("ATACADO")).toBe(true);
  });

  it("trata armazenadores de não-venda conhecidos como não-venda", () => {
    expect(sellsProducts("Defeito")).toBe(false);
    expect(sellsProducts("Lixeira (temporário)")).toBe(false);
    expect(sellsProducts("Bonificação")).toBe(false);
    expect(sellsProducts("Marketing/Produção")).toBe(false);
    expect(sellsProducts("Extraviado")).toBe(false);
  });

  it("trata Conserto como não-venda (achado 2026-10-27 — sem isso, roubava o primaryStoreId do CD)", () => {
    expect(sellsProducts("Conserto (enviados para conserto aguardando retor)")).toBe(false);
  });
});
