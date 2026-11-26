import { describe, it, expect, vi, beforeEach } from "vitest";

// Bug real (auditoria de Clientes, 2026-11-26, docs/auditoria-clientes-2026-11-26.md seção 2):
// getSugestoesDeContato é construída inteiramente a partir de getClienteSegmentacao — herdava o
// mesmo problema (pedido 100% devolvido contando como compra de verdade): um cliente cujo único
// pedido foi inteiramente devolvido podia cair no pool "Comprou só 1 vez"/"VIP esfriando" da aba
// Sugestões de Contato, mesmo não tendo, na prática, nenhuma compra líquida. Como nenhum código
// de contato-vendedor.ts precisou mudar (a correção é 100% em getClienteSegmentacao, ver
// pedidoDevolvidoTotalNaoConta.test.ts), este teste prova que o pipeline INTEIRO (não só a
// função isolada) deixa de sugerir esse cliente.

const queryRaw = vi.fn();
const saleFindMany = vi.fn();
const saleGroupBy = vi.fn();
const clienteCadastroFindMany = vi.fn();
const vendaHistoricaFindMany = vi.fn();
const storeFindMany = vi.fn();
const returnFindMany = vi.fn();
const contatoMarcadoFindMany = vi.fn();

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
    contatoMarcado: { findMany: (...a: unknown[]) => contatoMarcadoFindMany(...a) },
  },
}));

const baseFilters = {
  from: new Date(0), to: new Date(), storeIds: undefined, marcas: undefined, tabelasPreco: undefined,
  grupoIn: undefined, tamanhoIn: undefined, colecaoIn: undefined,
};

// ~80 dias atrás — dentro da janela "esfriando" (70-90 dias) usada pelos pools de VIP/Recorrente,
// pra garantir que, SE o bug reaparecer (cliente volta a contar com pedido 100% devolvido), ele
// seria mesmo selecionado pelo pool de VIP esfriando (não cai fora só por data).
const OITENTA_DIAS_ATRAS = new Date(Date.now() - 80 * 86400000);

describe("getSugestoesDeContato — pedido 100% devolvido não entra no pool de sugestões", () => {
  beforeEach(() => {
    queryRaw.mockReset();
    saleFindMany.mockReset();
    saleGroupBy.mockReset();
    clienteCadastroFindMany.mockReset();
    vendaHistoricaFindMany.mockReset();
    storeFindMany.mockReset();
    returnFindMany.mockReset();
    contatoMarcadoFindMany.mockReset();
    // getClienteSegmentacao/getAniversariantesDoMes (core.ts cacheAsync) e getB2BClienteNomes
    // cacheiam em variável de módulo — sem resetModules, o cache de um teste vazaria pro outro
    // (mesmo padrão de clienteRetencao.test.ts/variacaoGrupo.test.ts).
    vi.resetModules();
  });

  it("cliente com 1 único pedido 100% devolvido, telefone cadastrado e recência de 'VIP esfriando' NÃO aparece nas sugestões", async () => {
    // getClienteSegmentacao(filters, "b2c") e getAniversariantesDoMes(...) rodam concorrentes
    // (Promise.all) e cada um chama canalWhere("b2c") -> getB2BClienteNomes() de forma
    // independente — distinguir pela FORMA do `where` (tabelaPreco="Tabela atacado" = checagem de
    // B2B) é mais robusto que tentar sequenciar mockResolvedValueOnce entre chamadas concorrentes.
    saleFindMany.mockImplementation((args: { where?: { tabelaPreco?: string } }) => {
      if (args?.where?.tabelaPreco === "Tabela atacado") return Promise.resolve([]); // getB2BClienteNomes
      // Query principal da Segmentação: 1 cliente, 1 pedido, devolvido por completo.
      return Promise.resolve([
        {
          clienteNome: "CLIENTE DEVOLVIDO", saleDate: OITENTA_DIAS_ATRAS, dapicVendaId: 10, storeId: "store-leblon",
          valorTotalLiquido: 300, quantidade: 5, grupo: "Grupo A",
          store: { name: "Leblon", code: "Leblon", displayGroup: "Leblon" },
        },
      ]);
    });
    saleGroupBy.mockResolvedValue([]); // getAniversariantesDoMes: clientesFiltrados -> ninguém, pool vazio
    storeFindMany.mockResolvedValue([{ id: "store-cd" }, { id: "store-atacado" }]); // getSiteAtacadoStoreIds
    returnFindMany.mockResolvedValue([
      { storeId: "store-leblon", dapicVendaId: 10, quantidade: 5 }, // devolve as 5 unidades inteiras
    ]);
    queryRaw.mockResolvedValue([]); // B2B CNPJ join + getPrimeiraCompraGlobalPorCliente (se chamados)
    // Telefone presente — se o bug reaparecer e o cliente contar como "vip", ele teria como ser
    // contatado (senão o filtro de telefone já esconderia o problema por outro motivo).
    clienteCadastroFindMany.mockResolvedValue([{ nome: "CLIENTE DEVOLVIDO", telefone: "11999999999", celular: null }]);
    contatoMarcadoFindMany.mockResolvedValue([]); // ninguém contatado recentemente

    const { getSugestoesDeContato } = await import("../contato-vendedor");
    const sugestoes = await getSugestoesDeContato(baseFilters);

    expect(sugestoes.find((s) => s.cliente === "CLIENTE DEVOLVIDO")).toBeUndefined();
  });
});
