import { describe, it, expect, vi, beforeEach } from "vitest";
import { TipoCompraProduto } from "@prisma/client";

// Achado 1 da auditoria pós-incidente de 2026-11-25: a CAMADA DE DADOS de distribuicao-estoque.ts
// (montarComparacaoSemCache, por trás de getComparacaoCompleta) montava ComparacaoVariante.tipoCompra
// só a partir de ClassificacaoProduto.tipoCompra — um produto Best Seller REAL (StockSnapshot.colecao
// === "BESTSELLER", sem nenhuma linha manual em ClassificacaoProduto) chegava aqui com tipoCompra=null,
// tratado como "desconhecido" em todo o motor de Distribuição (e, por extensão, em
// planejamento-estoque.ts/planejamento-distribuicao.ts, que reaproveitam esta mesma `variante`).
// Este teste exercita a função de dados real (não só a pura) pra provar que a integração com
// resolverTipoCompraEfetivo (compras-inteligencia.ts) está de fato ligada na ponta a ponta.

const storeFindMany = vi.fn();
const saleGroupBy = vi.fn();
const stockSnapshotFindMany = vi.fn();
const stockMinimumRuleFindMany = vi.fn();
const classificacaoProdutoFindMany = vi.fn();
const productionOrderGroupBy = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: (...a: unknown[]) => storeFindMany(...a) },
    sale: { groupBy: (...a: unknown[]) => saleGroupBy(...a) },
    stockSnapshot: { findMany: (...a: unknown[]) => stockSnapshotFindMany(...a) },
    stockMinimumRule: { findMany: (...a: unknown[]) => stockMinimumRuleFindMany(...a) },
    classificacaoProduto: { findMany: (...a: unknown[]) => classificacaoProdutoFindMany(...a) },
    productionOrder: { groupBy: (...a: unknown[]) => productionOrderGroupBy(...a) },
  },
}));

// cacheAsync real tem TTL de 15min por chave — bypassado aqui pra cada teste rodar contra os
// mocks mais recentes, nunca servir um resultado cacheado do teste anterior.
vi.mock("../core", async (importActual) => {
  const actual = await importActual<typeof import("../core")>();
  return { ...actual, cacheAsync: async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn() };
});

const COD_BS_MANUAL = "COD-BS-MANUAL";
const COD_BS_COLECAO = "COD-BS-COLECAO";
const COD_DROP_SAZONAL = "COD-DROP-SAZONAL";
const COD_MANUAL_OVERRIDE = "COD-MANUAL-OVERRIDE";

function stockRow(over: { cod: string; colecao: string | null; storeId: string }) {
  return {
    storeId: over.storeId,
    cod: over.cod,
    grupo: "Grupo X",
    produto: `Produto ${over.cod}`,
    tamanho: "M",
    colecao: over.colecao,
    quantidadeDisponivel: 10,
    estoqueMinimo: null,
    valorCusto: null,
  };
}

describe("distribuicao-estoque (camada de dados) — identidade Best Seller integrada (achado 1)", () => {
  beforeEach(() => {
    storeFindMany.mockReset().mockResolvedValue([
      { id: "store-a", name: "Loja A", code: "LA", displayGroup: null, sellsProducts: true },
      { id: "store-b", name: "Loja B", code: "LB", displayGroup: null, sellsProducts: true },
    ]);

    saleGroupBy.mockReset().mockImplementation((args: Record<string, unknown>) => {
      // getPosicoesEstoque: by storeId, _count — todas as lojas "venderam recentemente".
      if (args._count) {
        return Promise.resolve([
          { storeId: "store-a", _count: { _all: 1 } },
          { storeId: "store-b", _count: { _all: 1 } },
        ]);
      }
      // primeirasVendas: by cod, _min — sem histórico de venda (irrelevante pro que este teste cobre).
      if (args._min) return Promise.resolve([]);
      // vendas30/60/90: by storeId+cod, _sum — sem venda (irrelevante pro que este teste cobre).
      return Promise.resolve([]);
    });

    stockSnapshotFindMany.mockReset().mockImplementation((args: { distinct?: string[] }) => {
      const cods = [COD_BS_MANUAL, COD_BS_COLECAO, COD_DROP_SAZONAL, COD_MANUAL_OVERRIDE];
      if (args.distinct) {
        // Query de `cor` (distinct por cod) — sem cor cadastrada, irrelevante aqui.
        return Promise.resolve(cods.map((cod) => ({ cod, cor: null })));
      }
      // latestStockSnapshots — 1 posição (store-a) por cod, com a colecao real de cada cenário.
      return Promise.resolve([
        stockRow({ cod: COD_BS_MANUAL, colecao: null, storeId: "store-a" }),
        stockRow({ cod: COD_BS_COLECAO, colecao: "BESTSELLER", storeId: "store-a" }),
        stockRow({ cod: COD_DROP_SAZONAL, colecao: "V26.1", storeId: "store-a" }),
        stockRow({ cod: COD_MANUAL_OVERRIDE, colecao: "BESTSELLER", storeId: "store-a" }),
      ]);
    });

    stockMinimumRuleFindMany.mockReset().mockResolvedValue([]);
    // Classificação manual existe SÓ pra 2 dos 4 cods — os outros 2 não têm nenhuma linha em
    // ClassificacaoProduto, exatamente o cenário real do incidente.
    classificacaoProdutoFindMany.mockReset().mockResolvedValue([
      { cod: COD_BS_MANUAL, tipoCompra: TipoCompraProduto.BEST_SELLER },
      { cod: COD_MANUAL_OVERRIDE, tipoCompra: TipoCompraProduto.DROP },
    ]);
    productionOrderGroupBy.mockReset().mockResolvedValue([]);
  });

  it("cod Best Seller real (colecao=BESTSELLER, sem linha manual) chega com tipoCompra=BEST_SELLER, não null", async () => {
    const { getComparacaoCompleta } = await import("../distribuicao-estoque");
    const { variantes } = await getComparacaoCompleta({});
    const v = variantes.find((x) => x.cod === COD_BS_COLECAO);
    expect(v?.tipoCompra).toBe(TipoCompraProduto.BEST_SELLER);
  });

  it("cod com classificação manual BEST_SELLER continua BEST_SELLER (comportamento prévio preservado)", async () => {
    const { getComparacaoCompleta } = await import("../distribuicao-estoque");
    const { variantes } = await getComparacaoCompleta({});
    const v = variantes.find((x) => x.cod === COD_BS_MANUAL);
    expect(v?.tipoCompra).toBe(TipoCompraProduto.BEST_SELLER);
  });

  it("cod de coleção sazonal sem linha manual continua tipoCompra=null (nunca inferido fora de BESTSELLER)", async () => {
    const { getComparacaoCompleta } = await import("../distribuicao-estoque");
    const { variantes } = await getComparacaoCompleta({});
    const v = variantes.find((x) => x.cod === COD_DROP_SAZONAL);
    expect(v?.tipoCompra).toBeNull();
  });

  it("classificação manual DROP sobrescreve colecao=BESTSELLER (decisão humana explícita vence a inferência)", async () => {
    const { getComparacaoCompleta } = await import("../distribuicao-estoque");
    const { variantes } = await getComparacaoCompleta({});
    const v = variantes.find((x) => x.cod === COD_MANUAL_OVERRIDE);
    expect(v?.tipoCompra).toBe(TipoCompraProduto.DROP);
  });
});
