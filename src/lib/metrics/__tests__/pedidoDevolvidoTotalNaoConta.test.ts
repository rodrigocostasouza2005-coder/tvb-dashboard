import { describe, it, expect, vi, beforeEach } from "vitest";

// Bug real (auditoria de Clientes, 2026-11-26, docs/auditoria-clientes-2026-11-26.md seção 2):
// getClienteFicha já decidiu explicitamente que "pedido 100% devolvido não é um pedido comprado
// de verdade" (if (liquido <= 0) continue), mas getClienteSegmentacao e getClientesCrmOverview
// nunca consultavam Return — pedidos/receita/recência/corte de VIP (Segmentação) e a contagem de
// pedidos/clientes ativos (CRM Overview) eram 100% sobre Sale bruto. Um cliente cujo único
// pedido foi inteiramente devolvido podia aparecer como "ativo"/"ocasional"/"VIP", mesmo não
// tendo, na prática, nenhuma compra líquida — e herdava pro pool de Sugestões de Contato
// (ver sugestoesContatoExcluiPedidoDevolvidoTotal.test.ts).
//
// Corrigido aplicando a MESMA regra da Ficha (netar por PEDIDO, não por cliente, e excluir
// inteiro quando liquido <= 0), seguindo o mesmo padrão de exclusão de CD/Atacado (sem chave
// Sale<->Return confiável) já usado em getValorDevolvidoPorCliente/getClienteFicha.

const queryRaw = vi.fn();
const saleFindMany = vi.fn();
const saleGroupBy = vi.fn();
const clienteCadastroFindMany = vi.fn();
const vendaHistoricaFindMany = vi.fn();
const storeFindMany = vi.fn();
const returnFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    sale: {
      findMany: (...a: unknown[]) => saleFindMany(...a),
      groupBy: (...a: unknown[]) => saleGroupBy(...a),
    },
    clienteCadastro: { findMany: (...a: unknown[]) => clienteCadastroFindMany(...a) },
    vendaHistoricaExterna: { findMany: (...a: unknown[]) => vendaHistoricaFindMany(...a) },
    store: { findMany: (...a: unknown[]) => storeFindMany(...a) },
    return: { findMany: (...a: unknown[]) => returnFindMany(...a) },
  },
}));

const REF = new Date("2026-11-26T12:00:00Z");
const baseFilters = {
  from: new Date(0), to: REF, storeIds: undefined, marcas: undefined, tabelasPreco: undefined,
  grupoIn: undefined, tamanhoIn: undefined, colecaoIn: undefined,
};

function resetAll() {
  queryRaw.mockReset();
  saleFindMany.mockReset();
  saleGroupBy.mockReset();
  clienteCadastroFindMany.mockReset();
  vendaHistoricaFindMany.mockReset();
  storeFindMany.mockReset();
  returnFindMany.mockReset();
  // getSiteAtacadoStoreIds não é cacheada, mas getB2BClienteNomes (core.ts) é — sem resetModules,
  // o cache de um teste vazaria pro outro. Mesmo padrão de clienteRetencao.test.ts.
  vi.resetModules();
}

describe("getClienteSegmentacao — pedido 100% devolvido não conta", () => {
  beforeEach(resetAll);

  it("cliente com 1 único pedido 100% devolvido não aparece na segmentação (não é 'ativo'/'ocasional')", async () => {
    const D = new Date("2026-11-01T12:00:00Z");
    saleFindMany.mockResolvedValueOnce([
      {
        clienteNome: "CLIENTE DEVOLVIDO", saleDate: D, dapicVendaId: 10, storeId: "store-leblon",
        valorTotalLiquido: 300, quantidade: 5, grupo: "Grupo A",
        store: { name: "Leblon", code: "Leblon", displayGroup: "Leblon" },
      },
    ]);
    storeFindMany.mockResolvedValueOnce([{ id: "store-cd" }, { id: "store-atacado" }]); // getSiteAtacadoStoreIds
    returnFindMany.mockResolvedValueOnce([
      { storeId: "store-leblon", dapicVendaId: 10, quantidade: 5 }, // devolve as 5 unidades inteiras
    ]);

    const { getClienteSegmentacao } = await import("../clientes");
    const result = await getClienteSegmentacao(baseFilters, "todos", REF);

    // Sem a correção, esse cliente apareceria com 1 pedido/receita 300, classificado ocasional/vip.
    expect(result).toEqual([]);
  });

  it("cliente com pedido PARCIALMENTE devolvido (saldo líquido positivo) continua contando normalmente — sem regressão", async () => {
    const D = new Date("2026-11-01T12:00:00Z");
    // Cliente decoy com receita bem maior — evita que o corte de VIP (percentil 90) vire a
    // própria receita do cliente-alvo num universo de poucos clientes (não é o que este teste
    // quer verificar).
    saleFindMany.mockResolvedValueOnce([
      {
        clienteNome: "CLIENTE DECOY", saleDate: D, dapicVendaId: 999, storeId: "store-leblon",
        valorTotalLiquido: 10000, quantidade: 1, grupo: "Grupo B",
        store: { name: "Leblon", code: "Leblon", displayGroup: "Leblon" },
      },
      {
        clienteNome: "CLIENTE PARCIAL", saleDate: D, dapicVendaId: 20, storeId: "store-leblon",
        valorTotalLiquido: 300, quantidade: 5, grupo: "Grupo A",
        store: { name: "Leblon", code: "Leblon", displayGroup: "Leblon" },
      },
    ]);
    storeFindMany.mockResolvedValueOnce([{ id: "store-cd" }, { id: "store-atacado" }]);
    returnFindMany.mockResolvedValueOnce([
      { storeId: "store-leblon", dapicVendaId: 20, quantidade: 2 }, // devolve só 2 de 5 — saldo líquido 3
    ]);
    vendaHistoricaFindMany.mockResolvedValueOnce([]);
    queryRaw.mockResolvedValue([]); // getPrimeiraCompraGlobalPorCliente (2 chamadas) -> ninguém é "novo"
    clienteCadastroFindMany.mockResolvedValueOnce([]);

    const { getClienteSegmentacao } = await import("../clientes");
    const result = await getClienteSegmentacao(baseFilters, "todos", REF);

    const parcial = result.find((c) => c.cliente === "CLIENTE PARCIAL");
    expect(parcial).toBeDefined();
    expect(parcial!.pedidos).toBe(1);
    expect(parcial!.receitaBruta).toBe(300);
    expect(parcial!.segmento).toBe("ocasional");
  });
});

describe("getClientesCrmOverview — pedido 100% devolvido não conta como cliente ativo", () => {
  beforeEach(resetAll);

  it("cliente com 1 único pedido 100% devolvido não entra em ativos/pedidos/ocasionais", async () => {
    saleGroupBy.mockResolvedValueOnce([
      { clienteNome: "CLIENTE DEVOLVIDO", storeId: "store-leblon", dapicVendaId: 10, _sum: { quantidade: 5, valorTotalLiquido: 300 } },
    ]);
    // getValorDevolvidoPorCliente: returnsBrutos (select valorTotal)
    returnFindMany.mockResolvedValueOnce([
      { storeId: "store-leblon", dapicVendaId: 10, valorTotal: 300 },
    ]);
    storeFindMany.mockResolvedValue([{ id: "store-cd" }, { id: "store-atacado" }]); // getSiteAtacadoStoreIds (chamada 2x)
    saleFindMany.mockResolvedValueOnce([
      { storeId: "store-leblon", dapicVendaId: 10, clienteNome: "CLIENTE DEVOLVIDO" },
    ]);
    // getUnidadesDevolvidasPorPedido: devolução por pedido (select quantidade)
    returnFindMany.mockResolvedValueOnce([
      { storeId: "store-leblon", dapicVendaId: 10, quantidade: 5 },
    ]);
    queryRaw.mockResolvedValue([]); // getPrimeiraCompraGlobalPorCliente

    const { getClientesCrmOverview } = await import("../clientes");
    const result = await getClientesCrmOverview(baseFilters);

    // Sem a correção: ativos=1, pedidos=1, ocasionais=1 (só a receita líquida já netava pra 0).
    expect(result.ativos).toBe(0);
    expect(result.pedidos).toBe(0);
    expect(result.ocasionais).toBe(0);
  });

  it("cliente com pedido PARCIALMENTE devolvido continua contando normalmente — sem regressão", async () => {
    saleGroupBy.mockResolvedValueOnce([
      { clienteNome: "CLIENTE PARCIAL", storeId: "store-leblon", dapicVendaId: 20, _sum: { quantidade: 5, valorTotalLiquido: 300 } },
    ]);
    returnFindMany.mockResolvedValueOnce([
      { storeId: "store-leblon", dapicVendaId: 20, valorTotal: 120 },
    ]);
    storeFindMany.mockResolvedValue([{ id: "store-cd" }, { id: "store-atacado" }]);
    saleFindMany.mockResolvedValueOnce([
      { storeId: "store-leblon", dapicVendaId: 20, clienteNome: "CLIENTE PARCIAL" },
    ]);
    returnFindMany.mockResolvedValueOnce([
      { storeId: "store-leblon", dapicVendaId: 20, quantidade: 2 },
    ]);
    queryRaw.mockResolvedValue([]);

    const { getClientesCrmOverview } = await import("../clientes");
    const result = await getClientesCrmOverview(baseFilters);

    expect(result.ativos).toBe(1);
    expect(result.pedidos).toBe(1);
    expect(result.ocasionais).toBe(1);
    expect(result.receitaBruta).toBe(300);
    expect(result.receitaLiquida).toBe(180);
  });
});
