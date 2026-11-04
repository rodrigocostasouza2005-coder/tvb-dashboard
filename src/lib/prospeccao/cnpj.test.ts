import { describe, expect, it } from "vitest";
import { validarCnpj } from "./cnpj";

describe("validarCnpj", () => {
  it("accepts a valid numeric CNPJ and normalizes punctuation", () => {
    expect(validarCnpj("11.222.333/0001-81")).toBe("11222333000181");
  });
  it("rejects invalid check digits", () => {
    expect(validarCnpj("11.222.333/0001-80")).toBeNull();
  });
  it("rejects repeated characters and malformed lengths", () => {
    expect(validarCnpj("00.000.000/0000-00")).toBeNull();
    expect(validarCnpj("ABC")).toBeNull();
  });
});
