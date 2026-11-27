import { describe, it, expect, vi, beforeEach } from "vitest";

const vendedorFindMany = vi.fn();
const saleFindMany = vi.fn();
const clienteVendedorAtribuicaoFindMany = vi.fn();
const clienteVendedorAtribuicaoUpdateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    vendedor: { findMany: (...a: unknown[]) => vendedorFindMany(...a) },
    sale: { findMany: (...a: unknown[]) => saleFindMany(...a) },
    clienteVendedorAtribuicao: {
      findMany: (...a: unknown[]) => clienteVendedorAtribuicaoFindMany(...a),
      updateMany: (...a: unknown[]) => clienteVendedorAtribuicaoUpdateMany(...a),
    },
  },
}));

// Achado em produção real (2026-11-27): esta função buscava TODO o histórico de Sale de cada loja
// sem filtro de data, rodando pra todas as lojas a cada sync — um dos dois causadores do timeout
// de 300s do /api/sync (o outro foi checkForDuplicateSales, corrigido no mesmo incidente).
describe("sincronizarAtribuicoesComVendaReal — janela de 30 dias (achado de timeout em produção, 2026-11-27)", () => {
  beforeEach(() => {
    vendedorFindMany.mockReset().mockResolvedValue([{ id: "v1", nome: "Ana", storeId: "s1", ativo: true }]);
    saleFindMany.mockReset().mockResolvedValue([]);
    clienteVendedorAtribuicaoFindMany.mockReset().mockResolvedValue([]);
    clienteVendedorAtribuicaoUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  });

  it("filtra Sale por saleDate >= 30 dias atrás, não varre o histórico inteiro", async () => {
    const { sincronizarAtribuicoesComVendaReal } = await import("../contato-vendedor");
    const antes = Date.now();
    await sincronizarAtribuicoesComVendaReal("s1");

    expect(saleFindMany).toHaveBeenCalledTimes(1);
    const where = saleFindMany.mock.calls[0][0].where;
    expect(where.saleDate.gte).toBeInstanceOf(Date);

    const diasAtras = (antes - where.saleDate.gte.getTime()) / 86_400_000;
    expect(diasAtras).toBeGreaterThan(29.9);
    expect(diasAtras).toBeLessThan(30.1);
  });

  it("sem vendedor ativo na loja -> não chega nem a consultar Sale (early return)", async () => {
    vendedorFindMany.mockResolvedValue([]);
    const { sincronizarAtribuicoesComVendaReal } = await import("../contato-vendedor");
    const resultado = await sincronizarAtribuicoesComVendaReal("s1");

    expect(resultado).toBe(0);
    expect(saleFindMany).not.toHaveBeenCalled();
  });

  it("cliente cuja venda real mais recente é de outro vendedor ativo -> atualiza a atribuição", async () => {
    vendedorFindMany.mockResolvedValue([
      { id: "v1", nome: "Ana", storeId: "s1", ativo: true },
      { id: "v2", nome: "Bruno", storeId: "s1", ativo: true },
    ]);
    saleFindMany.mockResolvedValue([
      { clienteNome: "Cliente X", vendedor: "Bruno", saleDate: new Date() },
    ]);
    clienteVendedorAtribuicaoFindMany.mockResolvedValue([
      { id: "attr-1", clienteNorm: "CLIENTE X", vendedorAtualId: "v1" },
    ]);

    const { sincronizarAtribuicoesComVendaReal } = await import("../contato-vendedor");
    const resultado = await sincronizarAtribuicoesComVendaReal("s1");

    expect(clienteVendedorAtribuicaoUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["attr-1"] } },
      data: { vendedorAtualId: "v2" },
    });
    expect(resultado).toBe(0); // mock de updateMany devolve count: 0 por padrão, não testa o count em si
  });

  it("venda real mais recente já é do vendedor atual -> não chama updateMany à toa", async () => {
    saleFindMany.mockResolvedValue([{ clienteNome: "Cliente X", vendedor: "Ana", saleDate: new Date() }]);
    clienteVendedorAtribuicaoFindMany.mockResolvedValue([
      { id: "attr-1", clienteNorm: "CLIENTE X", vendedorAtualId: "v1" },
    ]);

    const { sincronizarAtribuicoesComVendaReal } = await import("../contato-vendedor");
    await sincronizarAtribuicoesComVendaReal("s1");

    expect(clienteVendedorAtribuicaoUpdateMany).not.toHaveBeenCalled();
  });

  it("vendedor real da venda não está mais ativo na loja -> nunca rouba a atribuição de volta pra ele", async () => {
    // Só Ana (v1) está ativa — a venda mais recente aponta "Carlos", que já saiu da loja.
    saleFindMany.mockResolvedValue([{ clienteNome: "Cliente X", vendedor: "Carlos", saleDate: new Date() }]);
    clienteVendedorAtribuicaoFindMany.mockResolvedValue([
      { id: "attr-1", clienteNorm: "CLIENTE X", vendedorAtualId: "v1" },
    ]);

    const { sincronizarAtribuicoesComVendaReal } = await import("../contato-vendedor");
    await sincronizarAtribuicoesComVendaReal("s1");

    expect(clienteVendedorAtribuicaoUpdateMany).not.toHaveBeenCalled();
  });
});
