import { describe, it, expect, vi, beforeEach } from "vitest";

const storeFindMany = vi.fn();
const saleFindMany = vi.fn();
const saleGroupBy = vi.fn();
const clienteCadastroFindMany = vi.fn();
const queryRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: (...a: unknown[]) => storeFindMany(...a) },
    sale: {
      findMany: (...a: unknown[]) => saleFindMany(...a),
      groupBy: (...a: unknown[]) => saleGroupBy(...a),
    },
    clienteCadastro: { findMany: (...a: unknown[]) => clienteCadastroFindMany(...a) },
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
  },
}));

const FROM = new Date("2026-10-01T00:00:00Z");
const TO = new Date("2026-10-31T23:59:59Z");
const baseFilters = { from: FROM, to: TO, storeIds: undefined, marcas: undefined, tabelasPreco: undefined, grupoIn: undefined, tamanhoIn: undefined, colecaoIn: undefined };

describe("getAtacadoClientes — contagem de pedidos e classificação de novo", () => {
  beforeEach(() => {
    storeFindMany.mockReset();
    saleFindMany.mockReset();
    saleGroupBy.mockReset();
    clienteCadastroFindMany.mockReset();
    queryRaw.mockReset();

    storeFindMany.mockResolvedValue([{ id: "store-atacado" }]);
    saleFindMany.mockResolvedValue([]); // getB2BClienteNomes (distinct "Tabela atacado")
    queryRaw.mockResolvedValue([]); // getB2BClienteNomes (join CNPJ)
    clienteCadastroFindMany.mockResolvedValue([]);
  });

  it("um pedido com várias linhas/itens conta como 1 pedido, não 1 por item", async () => {
    // O Prisma já agrega as linhas de um mesmo pedido (mesmo dapicVendaId) ANTES de devolver o
    // groupBy — por isso o mock representa isso como 1 única linha de saída já somada (qtd=6,
    // valor=600), do jeito que o Postgres realmente devolveria pra
    // by:["clienteNome","cidade","estado","dapicVendaId"]. O bug corrigido (ver atacado.ts) era
    // usar um groupBy SEM dapicVendaId no "by" + _count:{dapicVendaId:true}, que contava as 3
    // linhas originais em vez do pedido único — este teste prova que, com o "by" corrigido, 1
    // pedido com várias linhas produz corretamente pedidos=1 depois do colapso em JS.
    saleGroupBy
      .mockResolvedValueOnce([
        { clienteNome: "SEADI LTDA", cidade: "Touros", estado: "RN", dapicVendaId: 100, _sum: { quantidade: 6, valorTotalLiquido: 600 }, _max: { saleDate: FROM }, _min: { saleDate: FROM } },
      ])
      .mockResolvedValueOnce([]); // primeiraVendaGeral (ninguém antigo -> todo mundo "novo")

    const { getAtacadoClientes } = await import("../atacado");
    const result = await getAtacadoClientes(baseFilters);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].pedidos).toBe(1);
    expect(result.rows[0].unidades).toBe(6);
    expect(result.rows[0].receita).toBe(600);
  });

  it("2 pedidos distintos do mesmo cliente contam 2, não 1", async () => {
    saleGroupBy
      .mockResolvedValueOnce([
        { clienteNome: "SEADI LTDA", cidade: "Touros", estado: "RN", dapicVendaId: 100, _sum: { quantidade: 2, valorTotalLiquido: 200 }, _max: { saleDate: FROM }, _min: { saleDate: FROM } },
        { clienteNome: "SEADI LTDA", cidade: "Touros", estado: "RN", dapicVendaId: 101, _sum: { quantidade: 1, valorTotalLiquido: 100 }, _max: { saleDate: TO }, _min: { saleDate: TO } },
      ])
      .mockResolvedValueOnce([]);

    const { getAtacadoClientes } = await import("../atacado");
    const result = await getAtacadoClientes(baseFilters);

    expect(result.rows[0].pedidos).toBe(2);
  });

  it("'novo' é robusto a diferença de capitalização entre a consulta de histórico e a do período", async () => {
    saleGroupBy
      .mockResolvedValueOnce([
        { clienteNome: "Fulano Comercio", cidade: "São Paulo", estado: "SP", dapicVendaId: 200, _sum: { quantidade: 1, valorTotalLiquido: 50 }, _max: { saleDate: FROM }, _min: { saleDate: FROM } },
      ])
      // Histórico anterior tem o MESMO cliente, só que em maiúsculas (variação real de captura do DAPIC).
      .mockResolvedValueOnce([{ clienteNome: "FULANO COMERCIO", _count: { id: 3 } }]);

    const { getAtacadoClientes } = await import("../atacado");
    const result = await getAtacadoClientes(baseFilters);

    expect(result.rows[0].isNovo).toBe(false);
    expect(result.novosNoPeriodo).toBe(0);
  });

  it("cliente sem nenhuma compra anterior é classificado como novo", async () => {
    saleGroupBy
      .mockResolvedValueOnce([
        { clienteNome: "Cliente Novo Ltda", cidade: "Rio de Janeiro", estado: "RJ", dapicVendaId: 300, _sum: { quantidade: 1, valorTotalLiquido: 50 }, _max: { saleDate: FROM }, _min: { saleDate: FROM } },
      ])
      .mockResolvedValueOnce([]);

    const { getAtacadoClientes } = await import("../atacado");
    const result = await getAtacadoClientes(baseFilters);

    expect(result.rows[0].isNovo).toBe(true);
    expect(result.novosNoPeriodo).toBe(1);
  });
});
