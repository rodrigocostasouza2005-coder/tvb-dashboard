import { describe, it, expect } from "vitest";
import { defaultAllowedTabs, hasTabAccess } from "../tabs";

// Parte 2 da correção de vazamento financeiro em Analytics do Site (auditoria 2026-11-25):
// a página passou a esconder gasto/CPC/CPM/custoPorCompra/ROAS com canSeeFinancials, e
// "analytics-site" entrou em BLOCKED_BY_DEFAULT_FOR_VENDEDOR (tabs.ts) — mesma régua já aplicada
// a black-friday/performance/analise-performance. VENDEDOR sem override explícito não deve ter
// acesso à aba por padrão.

describe("analytics-site — bloqueada por padrão pra VENDEDOR", () => {
  it("defaultAllowedTabs(VENDEDOR) não inclui analytics-site", () => {
    const allowed = defaultAllowedTabs("VENDEDOR");
    expect(allowed).not.toContain("analytics-site");
  });

  it("ADMIN continua com acesso padrão a analytics-site (não é um bloqueio geral)", () => {
    const allowed = defaultAllowedTabs("ADMIN");
    expect(allowed).toContain("analytics-site");
  });

  it("hasTabAccess: VENDEDOR sem allowedTabs explícito (usa o default) não acessa analytics-site", () => {
    const user = { allowedTabs: [] as string[] };
    expect(hasTabAccess(user, "analytics-site", "VENDEDOR")).toBe(false);
  });

  it("hasTabAccess: VENDEDOR com override explícito liberando analytics-site acessa normalmente", () => {
    const user = { allowedTabs: ["analytics-site"] };
    expect(hasTabAccess(user, "analytics-site", "VENDEDOR")).toBe(true);
  });

  it("hasTabAccess: ADMIN sem allowedTabs explícito acessa analytics-site normalmente", () => {
    const user = { allowedTabs: [] as string[] };
    expect(hasTabAccess(user, "analytics-site", "ADMIN")).toBe(true);
  });
});
