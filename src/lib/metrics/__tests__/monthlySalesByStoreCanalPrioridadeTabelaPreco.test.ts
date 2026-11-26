import { describe, it, expect, vi, beforeEach } from "vitest";

// Bug real (auditoria "resumo executivo", 2026-11-26): getMonthlySalesByStore (única consumidora:
// Lâmina Mensal) reimplementa a classificação B2B/B2C em SQL puro, mas sem a MESMA hierarquia de
// confiança de canalWhere() (core.ts, fonte única de verdade validada contra o Excel real do
// Rodrigo). Em canalWhere(), o histórico do cliente (b2bClientes) só decide quando a venda em si
// não tem "tabelaPreco" (fallback) — nunca sobrescreve uma "tabelaPreco" explícita. A versão
// antiga de getMonthlySalesByStore usava o histórico do cliente como condição SEMPRE, não só como
// fallback, fazendo uma venda com tabelaPreco explícita não-atacado (ex: "Tabela varejo") de um
// cliente com histórico B2B virar B2B aqui e B2C em canalWhere() — confirmado contra o Neon dev:
// 7 vendas / R$1.617,30 / 3 clientes nos últimos 6 meses nessa divergência entre o card de
// cabeçalho (getMonthlySnapshotKpi, correto) e o gráfico de tendência (getMonthlySalesByStore,
// errado).
//
// Como a função usa $queryRaw puro (WHERE avaliado pelo Postgres, não pelo mock), a forma de
// provar o comportamento aqui é inspecionar o texto do fragmento SQL de canal gerado — mesma
// técnica já usada em salesByDayPerStore.test.ts pra bug equivalente de SQL raw.

const queryRaw = vi.fn();
const saleFindMany = vi.fn();
const storeFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    sale: { findMany: (...a: unknown[]) => saleFindMany(...a) },
    store: { findMany: (...a: unknown[]) => storeFindMany(...a) },
  },
}));

const baseFilters = {
  from: new Date("2026-06-01T00:00:00.000-03:00"),
  to: new Date("2026-11-25T23:59:59.999-03:00"),
  storeIds: undefined as string[] | undefined,
  marcas: undefined as string[] | undefined,
  tabelasPreco: undefined as string[] | undefined,
  grupoIn: undefined as string[] | undefined,
  colecaoIn: undefined as string[] | undefined,
};

// ${canal === "b2b" ? Prisma.sql`...` : Prisma.empty} é um fragmento Prisma.Sql próprio (objeto
// com .sql/.values) interpolado como UM DOS VALORES da tagged template externa — não aparece no
// join() das strings literais externas. Precisa achar esse valor entre os argumentos da chamada
// e ler o .sql dele (mesmo helper de salesByDayPerStore.test.ts).
function sqlDosFragmentos(call: unknown[]): string {
  return call
    .slice(1)
    .filter((v): v is { sql: string } => typeof v === "object" && v !== null && "sql" in v)
    .map((v) => v.sql)
    .join(" | ");
}

beforeEach(() => {
  queryRaw.mockReset();
  saleFindMany.mockReset();
  storeFindMany.mockReset();
  // getB2BClienteNomes (core.ts) tem cache em memória por módulo — sem resetModules, o 2º teste
  // reaproveitaria o Set cacheado do 1º e os mocks de $queryRaw/sale.findMany não seriam
  // consumidos na ordem esperada.
  vi.resetModules();
});

describe("getMonthlySalesByStore — canal replica a MESMA prioridade de tabelaPreco de canalWhere()", () => {
  it("b2b: histórico do cliente só entra como fallback quando tabelaPreco é NULL (nunca sobrescreve tabelaPreco explícita)", async () => {
    saleFindMany.mockResolvedValueOnce([]); // getB2BClienteNomes: match exato "Tabela atacado"
    queryRaw.mockResolvedValueOnce([]); // getB2BClienteNomes: join CNPJ
    queryRaw.mockResolvedValueOnce([]); // query principal de getMonthlySalesByStore
    storeFindMany.mockResolvedValueOnce([]);

    const { getMonthlySalesByStore } = await import("../vendas");
    await getMonthlySalesByStore(baseFilters, "b2b");

    const fragmento = sqlDosFragmentos(queryRaw.mock.calls[1]);
    // SEM a correção, o fragmento era `"tabelaPreco" = 'Tabela atacado' OR "clienteNome" = ANY(...)`
    // — sem o guard `("tabelaPreco" IS NULL AND ...)`, essa asserção falha no código antigo.
    expect(fragmento).toContain(`"tabelaPreco" = 'Tabela atacado' OR ("tabelaPreco" IS NULL AND "clienteNome" = ANY`);
  });

  it("b2c: tabelaPreco explícita não-atacado inclui a venda mesmo com cliente de histórico B2B (bate com canalWhere)", async () => {
    saleFindMany.mockResolvedValueOnce([]);
    queryRaw.mockResolvedValueOnce([]);
    queryRaw.mockResolvedValueOnce([]);
    storeFindMany.mockResolvedValueOnce([]);

    const { getMonthlySalesByStore } = await import("../vendas");
    await getMonthlySalesByStore(baseFilters, "b2c");

    const fragmento = sqlDosFragmentos(queryRaw.mock.calls[1]);
    // SEM a correção, o fragmento era `("clienteNome" IS NULL OR "clienteNome" <> ALL(...))` —
    // faltava o `"tabelaPreco" IS NOT NULL OR` inicial, essa asserção falha no código antigo.
    expect(fragmento).toContain(`"tabelaPreco" IS NOT NULL OR "clienteNome" IS NULL OR "clienteNome" <> ALL`);
  });

  it("todos: nenhuma condição de canal é aplicada (comportamento preservado)", async () => {
    queryRaw.mockResolvedValueOnce([]); // query principal (canal="todos" não chama getB2BClienteNomes)
    storeFindMany.mockResolvedValueOnce([]);

    const { getMonthlySalesByStore } = await import("../vendas");
    await getMonthlySalesByStore(baseFilters, "todos");

    expect(saleFindMany).not.toHaveBeenCalled();
    const fragmento = sqlDosFragmentos(queryRaw.mock.calls[0]);
    expect(fragmento).not.toContain("tabelaPreco");
    expect(fragmento).not.toContain("clienteNome");
  });
});
