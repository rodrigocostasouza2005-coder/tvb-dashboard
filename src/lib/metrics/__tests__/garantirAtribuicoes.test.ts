import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks mínimos pra isolar getAtribuicoesPorCliente/garantirAtribuicoes sem precisar de banco.
const clienteVendedorAtribuicaoFindMany = vi.fn();
const clienteVendedorAtribuicaoCreateMany = vi.fn();
const vendedorFindMany = vi.fn();
const clienteCadastroFindMany = vi.fn();
const saleFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clienteVendedorAtribuicao: {
      findMany: (...a: unknown[]) => clienteVendedorAtribuicaoFindMany(...a),
      createMany: (...a: unknown[]) => clienteVendedorAtribuicaoCreateMany(...a),
    },
    vendedor: { findMany: (...a: unknown[]) => vendedorFindMany(...a) },
    clienteCadastro: { findMany: (...a: unknown[]) => clienteCadastroFindMany(...a) },
    sale: { findMany: (...a: unknown[]) => saleFindMany(...a) },
  },
}));

describe("garantirAtribuicoes (via getAtribuicoesPorCliente) — caso real Matheus→Caio", () => {
  beforeEach(() => {
    clienteVendedorAtribuicaoFindMany.mockReset();
    clienteVendedorAtribuicaoCreateMany.mockReset();
    vendedorFindMany.mockReset();
    clienteCadastroFindMany.mockReset();
    saleFindMany.mockReset();
  });

  it("atribui ao vendedor da venda mais recente, não ao primeiro do round-robin", async () => {
    // "Jander Monteiro" comprou com MATHEUS e ainda não tem nenhuma atribuição. Vendedores
    // ativos vêm ordenados com CAIO antes de MATHEUS (ordem alfabética) — é exatamente esse
    // sorteio (i=0 -> CAIO) que causava o bug reproduzido em produção em 2026-10-09.
    clienteVendedorAtribuicaoFindMany
      .mockResolvedValueOnce([]) // "já tem atribuição?" -> ninguém
      .mockResolvedValueOnce([
        // leitura final, depois de criar
        { clienteNorm: "JANDER MONTEIRO", vendedorAtual: { nome: "MATHEUS PEREIRA DE ALMEIDA" }, vendedorOriginal: null },
      ]);
    vendedorFindMany.mockResolvedValue([
      { id: "v-caio", nome: "CAIO DAVID CASTRO DE LUCENA" },
      { id: "v-matheus", nome: "MATHEUS PEREIRA DE ALMEIDA" },
    ]);
    clienteCadastroFindMany.mockResolvedValue([]); // sem vendedorResponsavel cadastrado
    saleFindMany.mockResolvedValue([{ clienteNome: "Jander Monteiro", vendedor: "MATHEUS PEREIRA DE ALMEIDA" }]);

    const { getAtribuicoesPorCliente } = await import("../contato-vendedor");
    const result = await getAtribuicoesPorCliente("store-leblon", ["Jander Monteiro"]);

    expect(clienteVendedorAtribuicaoCreateMany).toHaveBeenCalledWith({
      data: [{ storeId: "store-leblon", clienteNorm: "JANDER MONTEIRO", vendedorAtualId: "v-matheus" }],
      skipDuplicates: true,
    });
    expect(result.get("JANDER MONTEIRO")?.vendedorAtual).toBe("MATHEUS PEREIRA DE ALMEIDA");
  });

  it("prioriza ClienteCadastro.vendedorResponsavel sobre o vendedor da venda", async () => {
    clienteVendedorAtribuicaoFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ clienteNorm: "FULANA", vendedorAtual: { nome: "CAIO DAVID CASTRO DE LUCENA" }, vendedorOriginal: null }]);
    vendedorFindMany.mockResolvedValue([
      { id: "v-caio", nome: "CAIO DAVID CASTRO DE LUCENA" },
      { id: "v-matheus", nome: "MATHEUS PEREIRA DE ALMEIDA" },
    ]);
    clienteCadastroFindMany.mockResolvedValue([{ nome: "Fulana", vendedorResponsavel: "CAIO DAVID CASTRO DE LUCENA" }]);
    // A venda mais recente foi com Matheus, mas o cadastro diz que o responsável é o Caio —
    // cadastro tem prioridade (mesma regra do backfill original).
    saleFindMany.mockResolvedValue([{ clienteNome: "Fulana", vendedor: "MATHEUS PEREIRA DE ALMEIDA" }]);

    const { getAtribuicoesPorCliente } = await import("../contato-vendedor");
    const result = await getAtribuicoesPorCliente("store-leblon", ["Fulana"]);

    expect(clienteVendedorAtribuicaoCreateMany).toHaveBeenCalledWith({
      data: [{ storeId: "store-leblon", clienteNorm: "FULANA", vendedorAtualId: "v-caio" }],
      skipDuplicates: true,
    });
    expect(result.get("FULANA")?.vendedorAtual).toBe("CAIO DAVID CASTRO DE LUCENA");
  });

  it("cai pra round-robin só quando não há nenhum sinal de vendedor (cadastro nem venda)", async () => {
    clienteVendedorAtribuicaoFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ clienteNorm: "CLIENTE SEM SINAL", vendedorAtual: { nome: "CAIO DAVID CASTRO DE LUCENA" }, vendedorOriginal: null }]);
    vendedorFindMany.mockResolvedValue([
      { id: "v-caio", nome: "CAIO DAVID CASTRO DE LUCENA" },
      { id: "v-matheus", nome: "MATHEUS PEREIRA DE ALMEIDA" },
    ]);
    clienteCadastroFindMany.mockResolvedValue([]);
    saleFindMany.mockResolvedValue([]); // nenhuma venda com vendedor identificado

    const { getAtribuicoesPorCliente } = await import("../contato-vendedor");
    await getAtribuicoesPorCliente("store-leblon", ["Cliente Sem Sinal"]);

    // Sem nenhum sinal, cai no round-robin — 1º vendedor ativo da lista (ordem alfabética).
    expect(clienteVendedorAtribuicaoCreateMany).toHaveBeenCalledWith({
      data: [{ storeId: "store-leblon", clienteNorm: "CLIENTE SEM SINAL", vendedorAtualId: "v-caio" }],
      skipDuplicates: true,
    });
  });

  it("não cria nada quando o cliente já tem atribuição (não sobrescreve carteira existente)", async () => {
    clienteVendedorAtribuicaoFindMany
      .mockResolvedValueOnce([{ clienteNorm: "JA ATRIBUIDO" }])
      .mockResolvedValueOnce([{ clienteNorm: "JA ATRIBUIDO", vendedorAtual: { nome: "CAIO DAVID CASTRO DE LUCENA" }, vendedorOriginal: null }]);

    const { getAtribuicoesPorCliente } = await import("../contato-vendedor");
    await getAtribuicoesPorCliente("store-leblon", ["Ja Atribuido"]);

    expect(clienteVendedorAtribuicaoCreateMany).not.toHaveBeenCalled();
    expect(vendedorFindMany).not.toHaveBeenCalled();
  });
});
