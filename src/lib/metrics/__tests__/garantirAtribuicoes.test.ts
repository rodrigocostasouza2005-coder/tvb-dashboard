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

  it("cadastro aponta um vendedor que não está ativo NESTA loja (ex: migrou de loja) -> cai pro vendedor da venda, nunca pro nome inválido", async () => {
    // Caso real achado em 2026-10-13 (reconciliação de produção): MARIA EDUARDA LIMA BOTELHO
    // migrou do Barra pro Leblon (ativo=false no Barra, ativo=true no Leblon). Clientes novos do
    // Barra cujo ClienteCadastro.vendedorResponsavel ainda aponta pra ela não podem receber o id
    // dela (ela não está na lista de vendedoresAtivos DESSA loja) — tem que cair pro próximo sinal
    // (vendedor da venda mais recente), e só pro round-robin se nem esse existir.
    clienteVendedorAtribuicaoFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ clienteNorm: "CLIENTE MIGRADA", vendedorAtual: { nome: "VICTOR MARINHO DOS ANJOS" }, vendedorOriginal: null }]);
    vendedorFindMany.mockResolvedValue([
      // Vendedora do cadastro (BOTELHO) não está nesta lista — não é mais ativa NESTA loja.
      { id: "v-estrela", nome: "MARIA EDUARDA DA SILVA ESTRELA" },
      { id: "v-victor", nome: "VICTOR MARINHO DOS ANJOS" },
    ]);
    clienteCadastroFindMany.mockResolvedValue([{ nome: "Cliente Migrada", vendedorResponsavel: "MARIA EDUARDA LIMA BOTELHO" }]);
    saleFindMany.mockResolvedValue([{ clienteNome: "Cliente Migrada", vendedor: "VICTOR MARINHO DOS ANJOS" }]);

    const { getAtribuicoesPorCliente } = await import("../contato-vendedor");
    const result = await getAtribuicoesPorCliente("store-barra", ["Cliente Migrada"]);

    expect(clienteVendedorAtribuicaoCreateMany).toHaveBeenCalledWith({
      data: [{ storeId: "store-barra", clienteNorm: "CLIENTE MIGRADA", vendedorAtualId: "v-victor" }],
      skipDuplicates: true,
    });
    expect(result.get("CLIENTE MIGRADA")?.vendedorAtual).toBe("VICTOR MARINHO DOS ANJOS");
  });

  it("chamadas repetidas em sequência não duplicam: a 2ª chamada não encontra ninguém faltando e não cria nada", async () => {
    // 1ª chamada: cliente não tem atribuição, cria uma.
    clienteVendedorAtribuicaoFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ clienteNorm: "CLIENTE REPETIDO", vendedorAtual: { nome: "CAIO DAVID CASTRO DE LUCENA" }, vendedorOriginal: null }]);
    vendedorFindMany.mockResolvedValue([{ id: "v-caio", nome: "CAIO DAVID CASTRO DE LUCENA" }]);
    clienteCadastroFindMany.mockResolvedValue([]);
    saleFindMany.mockResolvedValue([{ clienteNome: "Cliente Repetido", vendedor: "CAIO DAVID CASTRO DE LUCENA" }]);

    const { getAtribuicoesPorCliente } = await import("../contato-vendedor");
    await getAtribuicoesPorCliente("store-leblon", ["Cliente Repetido"]);
    expect(clienteVendedorAtribuicaoCreateMany).toHaveBeenCalledTimes(1);

    clienteVendedorAtribuicaoCreateMany.mockClear();
    vendedorFindMany.mockClear();

    // 2ª chamada: agora a linha já existe (simula o createMany anterior ter persistido) — a
    // primeira findMany ("já tem?") já retorna o cliente, então nada deve ser criado de novo.
    clienteVendedorAtribuicaoFindMany
      .mockResolvedValueOnce([{ clienteNorm: "CLIENTE REPETIDO" }])
      .mockResolvedValueOnce([{ clienteNorm: "CLIENTE REPETIDO", vendedorAtual: { nome: "CAIO DAVID CASTRO DE LUCENA" }, vendedorOriginal: null }]);

    await getAtribuicoesPorCliente("store-leblon", ["Cliente Repetido"]);
    expect(clienteVendedorAtribuicaoCreateMany).not.toHaveBeenCalled();
    expect(vendedorFindMany).not.toHaveBeenCalled();
  });
});
