import { describe, it, expect, vi, beforeEach } from "vitest";

const storeFindMany = vi.fn();
const saleFindMany = vi.fn();
const saleGroupBy = vi.fn();
const vendaHistoricaFindMany = vi.fn();
const vendaHistoricaGroupBy = vi.fn();
const queryRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: (...a: unknown[]) => storeFindMany(...a) },
    sale: {
      findMany: (...a: unknown[]) => saleFindMany(...a),
      groupBy: (...a: unknown[]) => saleGroupBy(...a),
    },
    vendaHistoricaExterna: {
      findMany: (...a: unknown[]) => vendaHistoricaFindMany(...a),
      groupBy: (...a: unknown[]) => vendaHistoricaGroupBy(...a),
    },
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
  },
}));

const FROM = new Date("2026-10-01T00:00:00Z");
const TO = new Date("2026-10-31T23:59:59Z");
const baseFilters = { from: FROM, to: TO, storeIds: undefined, marcas: undefined, tabelasPreco: undefined, grupoIn: undefined, tamanhoIn: undefined, colecaoIn: undefined };

describe("getClienteRetencaoPorMes (atacado) — pedido qualificado por loja e nome normalizado", () => {
  beforeEach(() => {
    storeFindMany.mockReset();
    saleFindMany.mockReset();
    saleGroupBy.mockReset();
    queryRaw.mockReset();
    storeFindMany.mockResolvedValue([{ id: "store-cd" }, { id: "store-atacado" }]);
    saleFindMany.mockResolvedValue([]); // getB2BClienteNomes
    queryRaw.mockResolvedValue([]); // getB2BClienteNomes (CNPJ)
    // getB2BClienteNomes (core.ts) cacheia em variável de módulo — sem isso, o cache do 1º teste
    // vazava pro 2º (getB2BClienteNomes nem chamava prisma de novo), bagunçando a fila de mocks.
    vi.resetModules();
  });

  it("2 pedidos em lojas diferentes com o MESMO dapicVendaId contam como 2 pedidos, não 1 (dapicVendaId só é único por loja)", async () => {
    saleFindMany
      .mockResolvedValueOnce([]) // getB2BClienteNomes
      .mockResolvedValueOnce([
        { clienteNome: "FULANO LTDA", saleDate: FROM, dapicVendaId: 7, storeId: "store-cd" },
        { clienteNome: "FULANO LTDA", saleDate: TO, dapicVendaId: 7, storeId: "store-atacado" },
      ]);
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "FULANO LTDA", _min: { saleDate: FROM } }]);

    const { getClienteRetencaoPorMes } = await import("../clientes");
    const result = await getClienteRetencaoPorMes(baseFilters);

    expect(result.compraramMaisde1x).toBe(1);
    expect(result.compraram1x).toBe(0);
  });

  it("nome com capitalização diferente entre a 1ª compra histórica e a venda do mês não gera falso 'novo'", async () => {
    saleFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ clienteNome: "Fulano Ltda", saleDate: FROM, dapicVendaId: 9, storeId: "store-cd" }]);
    // Histórico: mesma empresa, grafia em caixa alta (variação real de captura do DAPIC).
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "FULANO LTDA", _min: { saleDate: new Date("2026-01-01") } }]);

    const { getClienteRetencaoPorMes } = await import("../clientes");
    const result = await getClienteRetencaoPorMes(baseFilters);

    const mesAtual = result.months.find((m) => m.month === "2026-10");
    expect(mesAtual?.recorrentes).toBe(1);
    expect(mesAtual?.novos).toBe(0);
  });
});

describe("getClienteRetencaoVarejo — pedido qualificado por loja", () => {
  beforeEach(() => {
    saleFindMany.mockReset();
    saleGroupBy.mockReset();
    vendaHistoricaFindMany.mockReset();
    vendaHistoricaGroupBy.mockReset();
    vendaHistoricaFindMany.mockResolvedValue([]);
    vendaHistoricaGroupBy.mockResolvedValue([]);
  });

  it("2 pedidos em lojas diferentes com o MESMO dapicVendaId contam como 2 pedidos distintos", async () => {
    saleFindMany.mockResolvedValueOnce([
      { clienteNome: "Maria Silva", saleDate: FROM, dapicVendaId: 5, storeId: "store-leblon" },
      { clienteNome: "Maria Silva", saleDate: TO, dapicVendaId: 5, storeId: "store-riosul" },
    ]);
    saleGroupBy.mockResolvedValueOnce([{ clienteNome: "Maria Silva", _min: { saleDate: FROM } }]);

    const { getClienteRetencaoVarejo } = await import("../clientes");
    const result = await getClienteRetencaoVarejo(baseFilters);

    expect(result.compraramMaisde1x).toBe(1);
    expect(result.compraram1x).toBe(0);
  });
});
