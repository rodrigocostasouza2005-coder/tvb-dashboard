import { describe, it, expect, vi, beforeEach } from "vitest";

// Auditoria 2026-11-25: Sell-through/Cohort/Cobertura/Estoque×Vendas tinham numerador e
// denominador respeitando filtros diferentes (Loja, Tabela de Preço, Marca) — essa suíte trava o
// comportamento corrigido: mesmo universo de filtro nos dois lados, exceto onde o schema não
// permite (documentado caso a caso).

const saleGroupBy = vi.fn();
const giftGroupBy = vi.fn();
const stockSnapshotGroupBy = vi.fn();
const returnGroupBy = vi.fn();
const saleFindMany = vi.fn();
const queryRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sale: {
      groupBy: (...a: unknown[]) => saleGroupBy(...a),
      findMany: (...a: unknown[]) => saleFindMany(...a),
    },
    gift: { groupBy: (...a: unknown[]) => giftGroupBy(...a) },
    stockSnapshot: { groupBy: (...a: unknown[]) => stockSnapshotGroupBy(...a) },
    return: { groupBy: (...a: unknown[]) => returnGroupBy(...a) },
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
  },
}));

beforeEach(() => {
  saleGroupBy.mockReset().mockResolvedValue([]);
  giftGroupBy.mockReset().mockResolvedValue([]);
  stockSnapshotGroupBy.mockReset().mockResolvedValue([]);
  returnGroupBy.mockReset().mockResolvedValue([]);
  saleFindMany.mockReset().mockResolvedValue([]);
  queryRaw.mockReset().mockResolvedValue([]);
});

describe("getSellthroughByColecao — filtro de Loja e Tabela de Preço", () => {
  it("storeIds entra no where de Sale, Gift, Stock e Return quando fornecido", async () => {
    const { getSellthroughByColecao } = await import("../sellthrough");
    await getSellthroughByColecao({ storeIds: ["loja-1"], marcas: undefined, grupoIn: undefined, tabelasPreco: undefined });

    expect(saleGroupBy.mock.calls[0][0].where).toMatchObject({ storeId: { in: ["loja-1"] } });
    expect(giftGroupBy.mock.calls[0][0].where).toMatchObject({ storeId: { in: ["loja-1"] } });
    expect(stockSnapshotGroupBy.mock.calls[0][0].where).toMatchObject({ storeId: { in: ["loja-1"] } });
    expect(returnGroupBy.mock.calls[0][0].where).toMatchObject({ storeId: { in: ["loja-1"] } });
  });

  it("tabelasPreco entra no where de Sale, mas NUNCA no de Stock (StockSnapshot não tem esse campo)", async () => {
    const { getSellthroughByColecao } = await import("../sellthrough");
    await getSellthroughByColecao({ storeIds: undefined, marcas: undefined, grupoIn: undefined, tabelasPreco: ["VAREJO"] });

    expect(saleGroupBy.mock.calls[0][0].where).toMatchObject({ tabelaPreco: { in: ["VAREJO"] } });
    expect(stockSnapshotGroupBy.mock.calls[0][0].where).not.toHaveProperty("tabelaPreco");
    // Gift tampouco tem tabelaPreco no schema.
    expect(giftGroupBy.mock.calls[0][0].where).not.toHaveProperty("tabelaPreco");
  });

  it("sem filtro nenhum, nenhum where extra de storeId/tabelaPreco é adicionado (comportamento anterior preservado)", async () => {
    const { getSellthroughByColecao } = await import("../sellthrough");
    await getSellthroughByColecao({ storeIds: undefined, marcas: undefined, grupoIn: undefined, tabelasPreco: undefined });

    expect(saleGroupBy.mock.calls[0][0].where).not.toHaveProperty("storeId");
    expect(saleGroupBy.mock.calls[0][0].where).not.toHaveProperty("tabelaPreco");
  });
});

describe("getSellthroughColecaoDetalhe — mesmos filtros do nível coleção", () => {
  it("storeIds e tabelasPreco entram no where de Sale; storeIds entra no de Return e Stock; tabelasPreco nunca entra no de Stock", async () => {
    const { getSellthroughColecaoDetalhe } = await import("../sellthrough");
    await getSellthroughColecaoDetalhe(
      { storeIds: ["loja-1"], marcas: undefined, grupoIn: undefined, tabelasPreco: ["VAREJO"] },
      "Verão 27"
    );

    expect(saleGroupBy.mock.calls[0][0].where).toMatchObject({ storeId: { in: ["loja-1"] }, tabelaPreco: { in: ["VAREJO"] } });
    expect(returnGroupBy.mock.calls[0][0].where).toMatchObject({ storeId: { in: ["loja-1"] } });
    expect(stockSnapshotGroupBy.mock.calls[0][0].where).toMatchObject({ storeId: { in: ["loja-1"] } });
    expect(stockSnapshotGroupBy.mock.calls[0][0].where).not.toHaveProperty("tabelaPreco");
  });
});

// Extrai os fragmentos Prisma.Sql interpolados numa chamada de $queryRaw tagged-template (mesmo
// helper já usado em salesByDayPerStore.test.ts para esse padrão no projeto).
function sqlDeTodosOsFragmentos(call: unknown[]): string {
  return call
    .filter((v): v is { sql: string } => typeof v === "object" && v !== null && "sql" in v)
    .map((v) => v.sql)
    .join(" | ");
}

describe("getColecaoCurvaVida — numerador (venda diária) respeita filtro de Loja", () => {
  it('inclui AND "storeId" = ANY quando storeIds é fornecido', async () => {
    queryRaw.mockResolvedValueOnce([]);
    const { getColecaoCurvaVida } = await import("../sellthrough");
    await getColecaoCurvaVida(
      { storeIds: ["loja-1"], marcas: undefined, grupoIn: undefined },
      [{ colecao: "Verão 27", produzido: 100 }]
    );

    const sql = sqlDeTodosOsFragmentos(queryRaw.mock.calls[0]);
    expect(sql).toContain('"storeId" = ANY');
  });

  it("sem storeIds, não filtra por loja (comportamento anterior preservado)", async () => {
    queryRaw.mockResolvedValueOnce([]);
    const { getColecaoCurvaVida } = await import("../sellthrough");
    await getColecaoCurvaVida(
      { storeIds: undefined, marcas: undefined, grupoIn: undefined },
      [{ colecao: "Verão 27", produzido: 100 }]
    );

    const sql = sqlDeTodosOsFragmentos(queryRaw.mock.calls[0]);
    expect(sql).not.toContain('"storeId" = ANY');
  });
});

describe("getSellthroughHierarquico — Sale/Gift/Return respeitam filtro de Loja (denominador por grupo/produto)", () => {
  it("storeIds entra no where de Sale e Return", async () => {
    const { getSellthroughHierarquico } = await import("../sellthrough");
    await getSellthroughHierarquico({ storeIds: ["loja-1"], marcas: undefined, grupoIn: undefined }, ["Verão 27"]);

    expect(saleGroupBy.mock.calls[0][0].where).toMatchObject({ storeId: { in: ["loja-1"] } });
    const returnCall = returnGroupBy.mock.calls[0][0];
    expect(returnCall.where).toMatchObject({ storeId: { in: ["loja-1"] } });
  });
});

describe("getCurvaVidaGrupoEProduto — numerador por grupo/produto respeita filtro de Loja", () => {
  it('inclui AND "storeId" = ANY no SQL quando storeIds é fornecido (parâmetro existia na assinatura mas nunca era usado na query)', async () => {
    // getCurvaVidaGrupoEProduto chama getSellthroughHierarquico (groupBy) e depois $queryRaw —
    // precisa de retorno não-vazio no groupBy de Sale pra alcançar a query raw.
    saleGroupBy.mockResolvedValueOnce([{ colecao: "Verão 27", grupo: "Camisetas", produto: "X", _sum: { quantidade: 1, valorTotalLiquido: 1 } }]);
    queryRaw.mockResolvedValueOnce([]);

    const { getCurvaVidaGrupoEProduto } = await import("../sellthrough");
    await getCurvaVidaGrupoEProduto(
      { storeIds: ["loja-1"], marcas: undefined, grupoIn: undefined },
      ["Verão 27"],
      90
    );

    const sql = sqlDeTodosOsFragmentos(queryRaw.mock.calls[0]);
    expect(sql).toContain('"storeId" = ANY');
  });
});
