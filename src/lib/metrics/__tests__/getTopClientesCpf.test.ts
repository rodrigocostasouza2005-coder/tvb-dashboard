import { describe, it, expect, vi, beforeEach } from "vitest";

// Achado real (2026-11-24, caso Felipe Haddad/CPF 34188858885): a aba Pesquisa buscava cliente só
// por clienteNome (contains) — diferente da Ficha do Cliente (getClienteFicha, mesmo arquivo), que
// já resolvia CPF/CNPJ via ClienteCadastro. Este teste prova que getTopClientes agora segue o
// mesmo padrão: texto digitado só-dígitos (8+ caracteres) tenta resolver pra um clienteNome exato
// via ClienteCadastro antes de montar o filtro.

const queryRaw = vi.fn();
const saleGroupBy = vi.fn();
const clienteCadastroFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    sale: { groupBy: (...a: unknown[]) => saleGroupBy(...a) },
    clienteCadastro: { findMany: (...a: unknown[]) => clienteCadastroFindMany(...a) },
  },
}));

beforeEach(() => {
  queryRaw.mockReset();
  saleGroupBy.mockReset();
  saleGroupBy.mockResolvedValue([]);
  clienteCadastroFindMany.mockReset().mockResolvedValue([]);
});

describe("getTopClientes — busca por CPF/CNPJ (resgatada da Ficha do Cliente)", () => {
  it("texto com 11 dígitos (CPF) resolve pra clienteNome via ClienteCadastro antes de filtrar Sale", async () => {
    queryRaw.mockResolvedValue([{ nome: "FELIPE HADDAD" }]);
    const { getTopClientes } = await import("../clientes");

    await getTopClientes({ storeIds: [], from: new Date("2026-01-01"), to: new Date("2026-12-31") }, null, 30, "todos", false, "34188858885");

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [primeiraChamada] = saleGroupBy.mock.calls[0] as [{ by: string[]; where: { clienteNome?: { contains?: string } } }];
    expect(primeiraChamada.where.clienteNome).toEqual({ contains: "FELIPE HADDAD", mode: "insensitive" });
  });

  it("CPF formatado (com pontuação) também resolve — compara só os dígitos", async () => {
    queryRaw.mockResolvedValue([{ nome: "FELIPE HADDAD" }]);
    const { getTopClientes } = await import("../clientes");

    await getTopClientes({ storeIds: [], from: new Date("2026-01-01"), to: new Date("2026-12-31") }, null, 30, "todos", false, "341.888.588-85");

    const sql = queryRaw.mock.calls[0];
    expect(sql).toBeTruthy();
    const [primeiraChamada] = saleGroupBy.mock.calls[0] as [{ where: { clienteNome?: { contains?: string } } }];
    expect(primeiraChamada.where.clienteNome).toEqual({ contains: "FELIPE HADDAD", mode: "insensitive" });
  });

  it("CPF sem cadastro correspondente cai pro comportamento antigo (contains pelo texto original)", async () => {
    queryRaw.mockResolvedValue([]);
    const { getTopClientes } = await import("../clientes");

    await getTopClientes({ storeIds: [], from: new Date("2026-01-01"), to: new Date("2026-12-31") }, null, 30, "todos", false, "99999999999");

    const [primeiraChamada] = saleGroupBy.mock.calls[0] as [{ where: { clienteNome?: { contains?: string } } }];
    expect(primeiraChamada.where.clienteNome).toEqual({ contains: "99999999999", mode: "insensitive" });
  });

  it("busca por nome (não-CPF) nunca consulta ClienteCadastro — comportamento antigo intacto", async () => {
    const { getTopClientes } = await import("../clientes");

    await getTopClientes({ storeIds: [], from: new Date("2026-01-01"), to: new Date("2026-12-31") }, null, 30, "todos", false, "Felipe Haddad");

    expect(queryRaw).not.toHaveBeenCalled();
    const [primeiraChamada] = saleGroupBy.mock.calls[0] as [{ where: { clienteNome?: { contains?: string } } }];
    expect(primeiraChamada.where.clienteNome).toEqual({ contains: "Felipe Haddad", mode: "insensitive" });
  });

  it("texto curto demais (menos de 8 dígitos) não tenta resolver via CPF, mesmo sendo só números", async () => {
    const { getTopClientes } = await import("../clientes");

    await getTopClientes({ storeIds: [], from: new Date("2026-01-01"), to: new Date("2026-12-31") }, null, 30, "todos", false, "1234");

    expect(queryRaw).not.toHaveBeenCalled();
  });
});
