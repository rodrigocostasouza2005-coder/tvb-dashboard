import { describe, expect, it } from "vitest";
import { isPublicAddress } from "./url-segura";

describe("validação de IP para pesquisa comercial", () => {
  it("aceita endereços IPv4 públicos", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("1.1.1.1")).toBe(true);
  });
  it("bloqueia faixas IPv4 privadas, locais e reservadas", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.1.1", "100.64.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.1", "224.0.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
  it("bloqueia loopback, link-local e unique-local IPv6", () => {
    for (const ip of ["::1", "fe80::1", "fc00::1", "fd00::1", "ff02::1", "::ffff:127.0.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
});
