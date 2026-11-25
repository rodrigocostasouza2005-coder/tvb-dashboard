import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";

// Vazamento de dado financeiro achado em auditoria 2026-11-25: analytics-site/page.tsx nunca
// chamava canSeeFinancials — gasto/CPC/CPM/custoPorCompra/ROAS do Meta Ads iam pro componente
// cliente (InvestimentoMetaAds) incondicionalmente, pra QUALQUER usuário com acesso à página.
// Corrigido pra computar showFinancials = canSeeFinancials(user) e remover esses 5 campos do
// próprio objeto (não só esconder na UI) antes de virar prop, quando showFinancials é false.
//
// Este teste chama a página REAL (analytics-site/page.tsx) com dependências mockadas e inspeciona
// o elemento React <InvestimentoMetaAds> retornado — prova que o arquivo de produção (não uma
// reimplementação da regra) de fato não inclui os campos financeiros no objeto quando
// showFinancials é false, e inclui quando é true.

const getSessionUser = vi.fn();
const canSeeFinancials = vi.fn();
const requireTabAccess = vi.fn();
const afterMock = vi.fn();
const syncLogCreate = vi.fn();

const getConversoes = vi.fn();
const getSessoesPorDia = vi.fn();
const getSessoesPorHora = vi.fn();
const getOrigemTrafego = vi.fn();
const getPaginasMaisVistas = vi.fn();
const getDispositivos = vi.fn();
const getGeografia = vi.fn();
const getNovoVsRecorrente = vi.fn();
const getAnuncios = vi.fn();
const getFunilCompra = vi.fn();

const getFotosPorNomeConjunto = vi.fn();
const getInsightsPorConjunto = vi.fn();
const getFotosPorNomeAnuncio = vi.fn();
const getInsightsPorAnuncio = vi.fn();
const getStatusPorNomeConjunto = vi.fn();
const getStatusPorNomeAnuncio = vi.fn();

vi.mock("@/lib/auth", () => ({ getSessionUser: (...a: unknown[]) => getSessionUser(...a) }));
vi.mock("@/lib/permissions", () => ({ canSeeFinancials: (...a: unknown[]) => canSeeFinancials(...a) }));
vi.mock("@/lib/tabs", () => ({ requireTabAccess: (...a: unknown[]) => requireTabAccess(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: { syncLog: { create: (...a: unknown[]) => syncLogCreate(...a) } } }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => afterMock(fn) };
});

vi.mock("@/lib/connectors/google-analytics", () => ({
  getConversoes: (...a: unknown[]) => getConversoes(...a),
  getSessoesPorDia: (...a: unknown[]) => getSessoesPorDia(...a),
  getSessoesPorHora: (...a: unknown[]) => getSessoesPorHora(...a),
  getOrigemTrafego: (...a: unknown[]) => getOrigemTrafego(...a),
  getPaginasMaisVistas: (...a: unknown[]) => getPaginasMaisVistas(...a),
  getDispositivos: (...a: unknown[]) => getDispositivos(...a),
  getGeografia: (...a: unknown[]) => getGeografia(...a),
  getNovoVsRecorrente: (...a: unknown[]) => getNovoVsRecorrente(...a),
  getAnuncios: (...a: unknown[]) => getAnuncios(...a),
  getFunilCompra: (...a: unknown[]) => getFunilCompra(...a),
}));

vi.mock("@/lib/connectors/meta-ads", () => ({
  getFotosPorNomeConjunto: (...a: unknown[]) => getFotosPorNomeConjunto(...a),
  getInsightsPorConjunto: (...a: unknown[]) => getInsightsPorConjunto(...a),
  getFotosPorNomeAnuncio: (...a: unknown[]) => getFotosPorNomeAnuncio(...a),
  getInsightsPorAnuncio: (...a: unknown[]) => getInsightsPorAnuncio(...a),
  getStatusPorNomeConjunto: (...a: unknown[]) => getStatusPorNomeConjunto(...a),
  getStatusPorNomeAnuncio: (...a: unknown[]) => getStatusPorNomeAnuncio(...a),
}));

// Componentes de exibição não mockados aqui (../investimento-meta-ads) continuam a implementação
// REAL — precisamos da referência real pra achar o elemento certo na árvore JSX devolvida pela
// página, e do tipo real (InvestimentoRow) pra garantir que o objeto construído em page.tsx bate
// com o que o componente espera. Os outros componentes de exibição (gráficos/tabelas que não
// interessam a este teste) são mockados só pra não pagar o custo de importar recharts etc.
vi.mock("../../stat-tile", () => ({ StatTile: () => null }));
vi.mock("../../pie-chart", () => ({ PieChart: () => null }));
vi.mock("../../indicadores/indicator-chart", () => ({ IndicatorChart: () => null }));
vi.mock("../../get-form", () => ({ GetForm: () => null }));
vi.mock("../foto-galeria", () => ({ FotoGaleria: () => null }));
vi.mock("../sessoes-por-hora-chart", () => ({ SessoesPorHoraChart: () => null }));

// Acha o primeiro elemento da árvore JSX (plain objects de React, sem renderizar nada) cujo
// `.type` é exatamente `type` — usado pra pegar o <InvestimentoMetaAds ... /> real devolvido pela
// página sem precisar de react-dom/renderToString.
function findElementByType(node: ReactNode, type: unknown): { props: Record<string, unknown> } | undefined {
  if (node == null || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementByType(child, type);
      if (found) return found;
    }
    return undefined;
  }
  const el = node as { type?: unknown; props?: { children?: ReactNode } };
  if (el.type === type) return el as { props: Record<string, unknown> };
  return findElementByType(el.props?.children, type);
}

const CONJUNTO_INSIGHT = {
  gasto: 1500.5,
  impressoes: 10000,
  alcance: 8000,
  cliques: 300,
  ctrPct: 3.0,
  cpc: 5.0,
  cpm: 150.05,
  compras: 20,
  roas: 2.5,
  custoPorCompra: 75.0,
};

beforeEach(() => {
  vi.clearAllMocks();
  getSessionUser.mockResolvedValue({ role: "ADMIN" });
  requireTabAccess.mockReturnValue(undefined);
  afterMock.mockImplementation(() => {});
  syncLogCreate.mockResolvedValue(undefined);

  getConversoes.mockResolvedValue({ sessoes: 100, usuarios: 90, conversoes: 5, taxaConversaoPct: 5 });
  getSessoesPorDia.mockResolvedValue([]);
  getSessoesPorHora.mockResolvedValue([]);
  getOrigemTrafego.mockResolvedValue([]);
  getPaginasMaisVistas.mockResolvedValue([]);
  getDispositivos.mockResolvedValue([]);
  getGeografia.mockResolvedValue([]);
  getNovoVsRecorrente.mockResolvedValue([]);
  getAnuncios.mockResolvedValue([]);
  getFunilCompra.mockResolvedValue([]);

  getInsightsPorConjunto.mockResolvedValue(new Map([["Conjunto A", CONJUNTO_INSIGHT]]));
  getInsightsPorAnuncio.mockResolvedValue(new Map());
  getFotosPorNomeConjunto.mockResolvedValue(new Map());
  getFotosPorNomeAnuncio.mockResolvedValue(new Map());
  getStatusPorNomeConjunto.mockResolvedValue(new Map([["Conjunto A", true]]));
  getStatusPorNomeAnuncio.mockResolvedValue(new Map());
});

describe("Analytics do Site — dado financeiro do Meta Ads só sai do servidor com canSeeFinancials", () => {
  it("canSeeFinancials=true: o objeto passado pro componente cliente TEM gasto/CPC/CPM/custoPorCompra/ROAS", async () => {
    canSeeFinancials.mockReturnValue(true);

    const { default: AnalyticsSitePage } = await import("../page");
    const { InvestimentoMetaAds } = await import("../investimento-meta-ads");
    const tree = await AnalyticsSitePage({ searchParams: Promise.resolve({}) });

    const el = findElementByType(tree, InvestimentoMetaAds);
    expect(el).toBeDefined();
    expect(el!.props.showFinancials).toBe(true);
    const rows = el!.props.porConjunto as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      nome: "Conjunto A",
      gasto: 1500.5,
      cpc: 5.0,
      cpm: 150.05,
      custoPorCompra: 75.0,
      roas: 2.5,
    });
  });

  it("canSeeFinancials=false: o objeto passado pro componente cliente NÃO TEM gasto/CPC/CPM/custoPorCompra/ROAS", async () => {
    canSeeFinancials.mockReturnValue(false);

    const { default: AnalyticsSitePage } = await import("../page");
    const { InvestimentoMetaAds } = await import("../investimento-meta-ads");
    const tree = await AnalyticsSitePage({ searchParams: Promise.resolve({}) });

    const el = findElementByType(tree, InvestimentoMetaAds);
    expect(el).toBeDefined();
    expect(el!.props.showFinancials).toBe(false);
    const rows = el!.props.porConjunto as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    // As chaves não existem no objeto — não é "undefined guardado", é AUSÊNCIA real (prova que
    // nenhuma manipulação no navegador recupera o dado: ele nunca chegou no payload).
    expect(Object.prototype.hasOwnProperty.call(rows[0], "gasto")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(rows[0], "cpc")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(rows[0], "cpm")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(rows[0], "custoPorCompra")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(rows[0], "roas")).toBe(false);
    // Campos não-monetários continuam presentes normalmente.
    expect(rows[0]).toMatchObject({ nome: "Conjunto A", cliques: 300, ctrPct: 3.0, compras: 20 });
  });
});
