import { describe, it, expect, vi, beforeEach } from "vitest";

// Bug real (auditoria de Clientes, 2026-11-26, docs/auditoria-clientes-2026-11-26.md seção 1):
// getClienteFicha classificava B2B/B2C pelo CLIENTE inteiro (`clienteEhB2B = sales.some(...)`,
// calculado 1x fora do loop) em vez de por VENDA — um cliente que já teve QUALQUER pedido batendo
// com "Tabela atacado" tinha TODOS os pedidos dele (inclusive os de varejo claro) contados como
// B2B nos KPIs "Pedidos B2B/B2C"/"Receita B2B/B2C" do topo da Ficha. Isso contradizia a regra
// central do projeto (classifySaleChannel/canalWhere, core.ts): a tabelaPreco da PRÓPRIA venda
// nunca deve ser sobrescrita pelo histórico do cliente — e contradizia a própria lista de Notas
// Fiscais da mesma tela (classificarCanalNota), que já classifica por pedido corretamente.
//
// Corrigido usando classifySaleChannel(s.tabelaPreco, ...) DENTRO do loop, mesmo padrão já usado
// em classificarCanalNota.

const queryRaw = vi.fn();
const saleFindMany = vi.fn();
const clienteCadastroFindMany = vi.fn();
const vendaHistoricaFindMany = vi.fn();
const storeFindMany = vi.fn();
const returnFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    sale: { findMany: (...a: unknown[]) => saleFindMany(...a) },
    clienteCadastro: { findMany: (...a: unknown[]) => clienteCadastroFindMany(...a) },
    vendaHistoricaExterna: { findMany: (...a: unknown[]) => vendaHistoricaFindMany(...a) },
    store: { findMany: (...a: unknown[]) => storeFindMany(...a) },
    return: { findMany: (...a: unknown[]) => returnFindMany(...a) },
  },
}));

const baseFilters = { storeIds: undefined, marcas: undefined, tabelasPreco: undefined, grupoIn: undefined };

describe("getClienteFicha — B2B/B2C classificado por VENDA, não pelo cliente inteiro", () => {
  beforeEach(() => {
    queryRaw.mockReset();
    saleFindMany.mockReset();
    clienteCadastroFindMany.mockReset();
    vendaHistoricaFindMany.mockReset();
    storeFindMany.mockReset();
    returnFindMany.mockReset();
    // getB2BClienteNomes (core.ts) cacheia em variável de módulo — sem resetModules, o cache do
    // 1º teste vazaria pro 2º (mesmo padrão de clienteRetencao.test.ts).
    vi.resetModules();
  });

  it("cliente com histórico de atacado (1 pedido antigo com Tabela atacado) que faz 1 pedido de varejo claro (Tabela varejo) — o pedido de varejo deve ser B2C, não B2B", async () => {
    const D1 = new Date("2026-01-10T12:00:00Z");
    const D2 = new Date("2026-11-20T12:00:00Z");

    queryRaw
      .mockResolvedValueOnce([{ nome: "ATACADO CLIENTE LTDA" }]) // variantRows
      .mockResolvedValueOnce([]); // getB2BClienteNomes: join CNPJ -> nenhum

    saleFindMany
      // 1) Promise.all — sales do cliente (pedido A: atacado antigo; pedido B: varejo claro)
      .mockResolvedValueOnce([
        {
          saleDate: D1, dapicVendaId: 100, storeId: "store-x", valorTotalLiquido: 500,
          quantidade: 5, tabelaPreco: "Tabela atacado", produto: "Produto A", tamanho: "M",
          grupo: "Grupo A", cidade: null, estado: null,
          store: { name: "Loja X", displayGroup: "Loja X", code: "LX" },
        },
        {
          saleDate: D2, dapicVendaId: 200, storeId: "store-x", valorTotalLiquido: 100,
          quantidade: 2, tabelaPreco: "Tabela varejo", produto: "Produto B", tamanho: "P",
          grupo: "Grupo B", cidade: null, estado: null,
          store: { name: "Loja X", displayGroup: "Loja X", code: "LX" },
        },
      ])
      // 2) getB2BClienteNomes — Tabela atacado histórica: este cliente já apareceu
      .mockResolvedValueOnce([{ clienteNome: "ATACADO CLIENTE LTDA" }]);

    clienteCadastroFindMany.mockResolvedValueOnce([]); // sem cadastro
    vendaHistoricaFindMany.mockResolvedValueOnce([]); // sem site antigo
    storeFindMany.mockResolvedValueOnce([{ id: "store-cd" }, { id: "store-atacado" }]); // getSiteAtacadoStoreIds
    returnFindMany.mockResolvedValueOnce([]); // sem devolução — isola o teste do bug 2

    const { getClienteFicha } = await import("../clientes");
    const ficha = await getClienteFicha(baseFilters, "Atacado Cliente Ltda");

    expect(ficha).not.toBeNull();
    // Pedido A (Tabela atacado) é B2B, pedido B (Tabela varejo) é B2C — cada um pela PRÓPRIA
    // tabelaPreco, não pelo flag fixo do cliente. Sem a correção, os 2 pedidos saíam como B2B
    // (pedidosB2B=2, pedidosB2C=0, receitaB2C=0).
    expect(ficha!.pedidosB2B).toBe(1);
    expect(ficha!.pedidosB2C).toBe(1);
    expect(ficha!.receitaB2B).toBe(500);
    expect(ficha!.receitaB2C).toBe(100);
  });
});
