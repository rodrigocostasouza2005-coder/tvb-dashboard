import { describe, it, expect, vi, beforeEach } from "vitest";
import { COLECAO_BEST_SELLER } from "../reposicao-bestseller-consolidada";

// CORREÇÃO DE FONTE (2026-11-23, revisão do PR #119 antes do merge): achado real de inconsistência
// entre o painel novo da Zona 1 (reposicao-bestseller-consolidada.ts, que usa
// colecao==="BESTSELLER") e getRecomendacoesBestSeller (que usava ClassificacaoProduto.tipoCompra,
// cobertura quase nula — 0 cods classificados no dev hoje). Um produto Best Seller de verdade
// (por coleção) aparecia certo na Zona 1 mas sem nenhuma recomendação na Aba 4/Mapa de Compras do
// MESMO produto. Este arquivo prova que as DUAS fontes concordam agora.

const classificacaoFindMany = vi.fn();
const stockSnapshotFindMany = vi.fn();
const stockSnapshotGroupBy = vi.fn();
const saleGroupBy = vi.fn();
const productionOrderGroupBy = vi.fn();
const coberturaMetaFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    classificacaoProduto: { findMany: (...a: unknown[]) => classificacaoFindMany(...a) },
    stockSnapshot: {
      findMany: (...a: unknown[]) => stockSnapshotFindMany(...a),
      groupBy: (...a: unknown[]) => stockSnapshotGroupBy(...a),
    },
    sale: { groupBy: (...a: unknown[]) => saleGroupBy(...a) },
    productionOrder: { groupBy: (...a: unknown[]) => productionOrderGroupBy(...a) },
    coberturaMeta: { findMany: (...a: unknown[]) => coberturaMetaFindMany(...a) },
  },
}));

beforeEach(() => {
  classificacaoFindMany.mockReset();
  stockSnapshotFindMany.mockReset();
  stockSnapshotGroupBy.mockReset();
  saleGroupBy.mockReset();
  productionOrderGroupBy.mockReset();
  coberturaMetaFindMany.mockReset();

  stockSnapshotGroupBy.mockImplementation((args: { where?: { cod?: { in: string[] } }; _avg?: unknown }) => {
    const cods: string[] = args.where?.cod?.in ?? [];
    if (args._avg) return Promise.resolve(cods.map((cod) => ({ cod, _avg: { valorCusto: null } })));
    return Promise.resolve(cods.map((cod) => ({ cod, _sum: { quantidadeDisponivel: 10 } })));
  });
  saleGroupBy.mockImplementation((args: { where?: { cod?: { in: string[] } }; _min?: unknown }) => {
    const cods: string[] = args.where?.cod?.in ?? [];
    if (args._min) return Promise.resolve(cods.map((cod) => ({ cod, _min: { saleDate: new Date(Date.now() - 60 * 86_400_000) } })));
    return Promise.resolve(cods.map((cod) => ({ cod, _sum: { quantidade: 30 } })));
  });
  productionOrderGroupBy.mockResolvedValue([]);
  coberturaMetaFindMany.mockResolvedValue([]);
});

describe("getRecomendacoesBestSeller — fonte de 'é Best Seller'", () => {
  it("NUNCA consulta ClassificacaoProduto pra decidir quem é Best Seller (fonte abandonada, cobertura quase nula)", async () => {
    stockSnapshotFindMany.mockResolvedValue([{ cod: "COD-BS-1", produto: "Classic Black", grupo: "Camisetas" }]);
    const { getRecomendacoesBestSeller } = await import("../compras-inteligencia");

    await getRecomendacoesBestSeller({});

    expect(classificacaoFindMany).not.toHaveBeenCalled();
  });

  it("usa StockSnapshot.colecao === COLECAO_BEST_SELLER — a MESMA constante do painel da Zona 1 (reposicao-bestseller-consolidada.ts)", async () => {
    stockSnapshotFindMany.mockResolvedValue([{ cod: "COD-BS-1", produto: "Classic Black", grupo: "Camisetas" }]);
    const { getRecomendacoesBestSeller } = await import("../compras-inteligencia");

    await getRecomendacoesBestSeller({});

    expect(stockSnapshotFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ colecao: COLECAO_BEST_SELLER }) })
    );
  });

  it("produto da Zona 1 (colecao=BESTSELLER) recebe recomendação coerente na Aba 4 — mesmo cod, mesma fonte", async () => {
    // Mesmo fixture que alimentaria agregarReposicaoBestSellerConsolidada (Zona 1): um cod real
    // com colecao=BESTSELLER.
    stockSnapshotFindMany.mockResolvedValue([{ cod: "COD-BS-1", produto: "Classic Black", grupo: "Camisetas" }]);
    const { getRecomendacoesBestSeller } = await import("../compras-inteligencia");

    const recomendacoes = await getRecomendacoesBestSeller({});

    expect(recomendacoes).toHaveLength(1);
    expect(recomendacoes[0].cod).toBe("COD-BS-1");
    expect(recomendacoes[0].produto).toBe("Classic Black");
  });

  it("grupoIn filtra o universo (where.grupo), igual ao comportamento anterior", async () => {
    stockSnapshotFindMany.mockResolvedValue([]);
    const { getRecomendacoesBestSeller } = await import("../compras-inteligencia");

    await getRecomendacoesBestSeller({ grupoIn: ["Camisetas"] });

    expect(stockSnapshotFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ colecao: COLECAO_BEST_SELLER, grupo: { in: ["Camisetas"] } }) })
    );
  });

  it("colecaoIn preenchido -> [] (conceito de ClassificacaoProduto.colecao não existe nesta fonte; nunca inclui Best Seller por engano numa coleção sazonal específica)", async () => {
    const { getRecomendacoesBestSeller } = await import("../compras-inteligencia");
    const r = await getRecomendacoesBestSeller({ colecaoIn: ["Drop Verão 26"] });
    expect(r).toEqual([]);
    expect(stockSnapshotFindMany).not.toHaveBeenCalled(); // nem chega a consultar — decisão explícita, não um filtro que zera depois
  });

  it("statusComercialIn preenchido -> [] (sem dado de statusComercial nesta fonte — nunca assume 'ativo' por adivinhação)", async () => {
    const { getRecomendacoesBestSeller } = await import("../compras-inteligencia");
    const r = await getRecomendacoesBestSeller({ statusComercialIn: ["ATIVO" as never] });
    expect(r).toEqual([]);
  });

  it("nenhum cod com colecao=BESTSELLER -> [] honesto, nunca erro", async () => {
    stockSnapshotFindMany.mockResolvedValue([]);
    const { getRecomendacoesBestSeller } = await import("../compras-inteligencia");
    const r = await getRecomendacoesBestSeller({});
    expect(r).toEqual([]);
  });
});

describe("getRecomendacoesDrop — fonte deliberadamente INTOCADA (continua ClassificacaoProduto)", () => {
  it("Drop continua consultando ClassificacaoProduto — não existe equivalente de dataEncerramentoPrevista/possibilidadeReposicao via colecao", async () => {
    classificacaoFindMany.mockResolvedValue([]);
    const { getRecomendacoesDrop } = await import("../compras-inteligencia");

    await getRecomendacoesDrop({});

    expect(classificacaoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tipoCompra: "DROP" }) })
    );
  });
});
