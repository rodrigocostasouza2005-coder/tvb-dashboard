import { describe, it, expect, vi, beforeEach } from "vitest";

// Bug real (investigação de 2026-11-25, continuação de "Faturamento negativo cd-atacado"):
// pra loja CD/ATACADO (token cd-atacado), Sale.dapicVendaId vem de /faturas (fatura.Id) mas
// Return.dapicVendaId da MESMA loja vem de /vendaspdv (venda.Id) — dois espaços de Id diferentes
// que só colidem por coincidência numérica. Confirmado (ver comentário em getValorDevolvidoPorCliente,
// clientes.ts) que não existe hoje identificador confiável pra juntar devolução↔cliente nessas 2
// lojas (vendaspdv não expõe CPF/CNPJ/IdCliente, e Return não grava clienteNome nem com migration
// fora de escopo). Decisão: excluir CD/ATACADO da netagem por cliente (líquida = bruta pra essas
// lojas, nunca atribuir devolução ao cliente errado por sorte do Id bater) — testado aqui via
// getProdutosLiquidosPorClientes, que é a função mais simples de mockar das 4 afetadas.

const queryRaw = vi.fn();
const saleFindMany = vi.fn();
const returnFindMany = vi.fn();
const storeFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    sale: { findMany: (...a: unknown[]) => saleFindMany(...a) },
    return: { findMany: (...a: unknown[]) => returnFindMany(...a) },
    store: { findMany: (...a: unknown[]) => storeFindMany(...a) },
  },
}));

beforeEach(() => {
  queryRaw.mockReset();
  saleFindMany.mockReset();
  returnFindMany.mockReset();
  storeFindMany.mockReset();
  // getSiteAtacadoStoreIds (core.ts): CD e ATACADO são os 2 ids "não confiáveis" pra essa chave.
  storeFindMany.mockResolvedValue([{ id: "store-cd" }, { id: "store-atacado" }]);
});

describe("getProdutosLiquidosPorClientes — CD/ATACADO não netam devolução por storeId+dapicVendaId", () => {
  it("devolução na loja CD com dapicVendaId coincidente NÃO é subtraída (correlação não confiável)", async () => {
    queryRaw.mockResolvedValueOnce([{ nome: "JOAO SILVA", norm: "JOAO SILVA" }]);
    saleFindMany.mockResolvedValueOnce([
      // Sale.dapicVendaId=500 vem de /faturas pra loja CD.
      { clienteNome: "JOAO SILVA", produto: "Camiseta Azul", quantidade: 10, storeId: "store-cd", dapicVendaId: 500 },
    ]);
    // Return.dapicVendaId=500 pra loja CD vem de /vendaspdv — MESMO número, fonte DIFERENTE,
    // coincidência pura. Sem a correção, isso seria juntado e descontaria 4 unidades.
    returnFindMany.mockResolvedValueOnce([
      { storeId: "store-cd", dapicVendaId: 500, produto: "Camiseta Azul", quantidade: 4 },
    ]);

    const { getProdutosLiquidosPorClientes } = await import("../clientes");
    const result = await getProdutosLiquidosPorClientes({ storeIds: undefined }, ["Joao Silva"]);

    // returnFindMany não deve nem ser chamada: storeIds ficou vazio depois de excluir CD/ATACADO.
    expect(returnFindMany).not.toHaveBeenCalled();
    expect(result.get("JOAO SILVA")).toEqual([{ produto: "Camiseta Azul", unidades: 10 }]);
  });

  it("devolução em loja física (não CD/ATACADO) continua netando normalmente — sem regressão", async () => {
    queryRaw.mockResolvedValueOnce([{ nome: "MARIA SOUZA", norm: "MARIA SOUZA" }]);
    saleFindMany.mockResolvedValueOnce([
      { clienteNome: "MARIA SOUZA", produto: "Calça Preta", quantidade: 8, storeId: "store-leblon", dapicVendaId: 42 },
    ]);
    returnFindMany.mockResolvedValueOnce([
      { storeId: "store-leblon", dapicVendaId: 42, produto: "Calça Preta", quantidade: 3 },
    ]);

    const { getProdutosLiquidosPorClientes } = await import("../clientes");
    const result = await getProdutosLiquidosPorClientes({ storeIds: undefined }, ["Maria Souza"]);

    expect(returnFindMany).toHaveBeenCalledTimes(1);
    const [{ where }] = returnFindMany.mock.calls[0] as [{ where: { storeId: { in: string[] } } }];
    expect(where.storeId.in).toEqual(["store-leblon"]);
    expect(result.get("MARIA SOUZA")).toEqual([{ produto: "Calça Preta", unidades: 5 }]);
  });
});
