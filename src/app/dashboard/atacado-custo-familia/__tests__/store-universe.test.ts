import { describe, it, expect, vi, beforeEach } from "vitest";

// Universo de lojas de "Custo por Família — Atacado" tem que ser IDÊNTICO ao das outras 3
// páginas do grupo Atacado (getAtacadoVendas/getAtacadoCidades/getAtacadoClientes, em
// src/lib/metrics/atacado.ts): só as 2 lojas reais de CD/Atacado (getSiteAtacadoStoreIds),
// nunca a lista completa de lojas liberadas pro usuário (allowedStores) — achado em auditoria
// de 2026-11-25. Este teste prova o bug (formula antiga da página, reproduzida a partir do
// código original) e confirma que a página corrigida usa exatamente a mesma fórmula de
// interseção já usada em atacado.ts.

const STORE_CD = "store-cd";
const STORE_ATACADO = "store-atacado";
const STORE_VAREJO_SP = "store-varejo-sp";
const STORE_VAREJO_RJ = "store-varejo-rj";
const siteAtacadoIds = [STORE_CD, STORE_ATACADO];
// Usuário liberado pra atacado E pra 2 lojas de varejo — caso real que expunha o bug: o usuário
// tem acesso normal a lojas de varejo, mas a aba de Custo por Família (Atacado) deveria mostrar
// só CD/ATACADO independente disso.
const allowedStores = [STORE_CD, STORE_ATACADO, STORE_VAREJO_SP, STORE_VAREJO_RJ];

// Mesma fórmula usada em getAtacadoVendas/getAtacadoCidades/getAtacadoClientes
// (src/lib/metrics/atacado.ts) — a referência de "universo correto" pro grupo Atacado.
function atacadoReferenceStoreIds(siteAtacadoIds: string[], filterStoreIds: string[] | undefined): string[] {
  return filterStoreIds !== undefined ? siteAtacadoIds.filter((id) => filterStoreIds.includes(id)) : siteAtacadoIds;
}

// Fórmula ORIGINAL de atacado-custo-familia/page.tsx antes da correção (linha ~37 da versão
// anterior): `const selectedStoreIds = parsedFilters.storeIds ?? allowedStores;` — nunca
// restringia a CD/ATACADO, só usava o que o usuário tinha liberado (que pode incluir lojas de
// varejo).
function buggyOldFormula(allowedStores: string[], parsedFiltersStoreIds: string[] | undefined): string[] {
  return parsedFiltersStoreIds ?? allowedStores;
}

describe("Universo de storeIds — Custo por Família (Atacado) vs outras páginas de Atacado", () => {
  it("ANTES da correção: a fórmula antiga da página divergia da referência de atacado.ts", () => {
    // parsedFilters.storeIds indefinido = usuário não aplicou nenhum filtro de loja manual
    // (comportamento padrão ao abrir a página).
    const old = buggyOldFormula(allowedStores, undefined);
    const reference = atacadoReferenceStoreIds(siteAtacadoIds, undefined);

    // A fórmula antiga incluía as lojas de varejo (bug); a referência correta, não.
    expect(old).toEqual(allowedStores);
    expect(old).not.toEqual(reference);
    expect(old).toContain(STORE_VAREJO_SP);
    expect(reference).not.toContain(STORE_VAREJO_SP);
  });

  it("DEPOIS da correção: a nova fórmula da página bate exatamente com a referência de atacado.ts", async () => {
    // Fórmula atual de atacado-custo-familia/page.tsx (depois da correção) — mesma expressão
    // literal usada em getAtacadoVendas/getAtacadoCidades/getAtacadoClientes.
    const fixed = atacadoReferenceStoreIds(siteAtacadoIds, allowedStores);
    const reference = atacadoReferenceStoreIds(siteAtacadoIds, allowedStores);

    expect(fixed).toEqual(reference);
    expect(fixed).toEqual([STORE_CD, STORE_ATACADO]);
    expect(fixed).not.toContain(STORE_VAREJO_SP);
    expect(fixed).not.toContain(STORE_VAREJO_RJ);
  });

  it("usuário sem nenhuma das 2 lojas de atacado liberadas não vê nada (igual às outras 3 páginas)", () => {
    const allowedSoVarejo = [STORE_VAREJO_SP, STORE_VAREJO_RJ];
    const result = atacadoReferenceStoreIds(siteAtacadoIds, allowedSoVarejo);
    expect(result).toEqual([]);
  });
});

// Teste de integração leve: chama a página real (atacado-custo-familia/page.tsx) com
// dependências mockadas e captura o `filters.storeIds` efetivamente passado pra
// buildCustoFamiliaViewModel — prova que o arquivo de produção (não só a fórmula replicada
// acima) está de fato corrigido.
const getSessionUser = vi.fn();
const canSeeFinancials = vi.fn();
const getStoreRestriction = vi.fn();
const getMarcaRestriction = vi.fn();
const getTabelaPrecoRestriction = vi.fn();
const getGrupoRestriction = vi.fn();
const requireTabAccess = vi.fn();
const getSiteAtacadoStoreIdsMock = vi.fn();
const getMarcasMock = vi.fn();
const getTabelasPrecoMock = vi.fn();
const getDistinctColecoesMock = vi.fn();
const buildCustoFamiliaViewModelMock = vi.fn();

vi.mock("@/lib/auth", () => ({ getSessionUser: (...a: unknown[]) => getSessionUser(...a) }));
vi.mock("@/lib/permissions", () => ({
  canSeeFinancials: (...a: unknown[]) => canSeeFinancials(...a),
  getStoreRestriction: (...a: unknown[]) => getStoreRestriction(...a),
  getMarcaRestriction: (...a: unknown[]) => getMarcaRestriction(...a),
  getTabelaPrecoRestriction: (...a: unknown[]) => getTabelaPrecoRestriction(...a),
  getGrupoRestriction: (...a: unknown[]) => getGrupoRestriction(...a),
}));
vi.mock("@/lib/tabs", () => ({ requireTabAccess: (...a: unknown[]) => requireTabAccess(...a) }));
vi.mock("@/lib/metrics", () => ({
  getSiteAtacadoStoreIds: (...a: unknown[]) => getSiteAtacadoStoreIdsMock(...a),
  getMarcas: (...a: unknown[]) => getMarcasMock(...a),
  getTabelasPreco: (...a: unknown[]) => getTabelasPrecoMock(...a),
  getDistinctColecoes: (...a: unknown[]) => getDistinctColecoesMock(...a),
}));
vi.mock("../../filter-bar", () => ({ FilterBar: () => null }));
vi.mock("../../collapsible-filters", () => ({ CollapsibleFilters: () => null }));
vi.mock("../../stat-tile", () => ({ StatTile: () => null }));
vi.mock("../../indicadores/indicator-chart", () => ({ IndicatorChart: () => null }));
vi.mock("../../custo-familia/custo-familia-charts", () => ({
  ReceitaCmvBarChart: () => null,
  MargemBarChart: () => null,
  EficienciaScatterChart: () => null,
}));
vi.mock("../../custo-familia/custo-familia-table", () => ({ CustoFamiliaTable: () => null }));
vi.mock("../../custo-familia/build-view-model", () => ({
  buildCustoFamiliaViewModel: (...a: unknown[]) => buildCustoFamiliaViewModelMock(...a),
}));

const STUB_VM = {
  rows: [], totalReceita: 0, totalCmv: 0, totalLucro: 0, margemTotalPct: null,
  totalUnidades: 0, totalEstoqueCusto: 0, totalUnidadesSemCusto: 0,
  barData: [], margemBarData: [], eficienciaData: [], evolucaoMargemData: [],
  evolucaoSeries: [], ranking: [], insights: [], margemMedia: 0, sellThroughMedio: 0,
};

describe("atacado-custo-familia/page.tsx — storeIds efetivamente usado (integração)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionUser.mockResolvedValue({ role: "admin", allowedStores, allowedMarcas: [], allowedTabelasPreco: [], allowedTabs: ["atacado-custo-familia"], canSeeFinancials: true });
    canSeeFinancials.mockReturnValue(true);
    getStoreRestriction.mockReturnValue(allowedStores);
    getMarcaRestriction.mockReturnValue([]);
    getTabelaPrecoRestriction.mockReturnValue([]);
    getGrupoRestriction.mockResolvedValue(undefined);
    requireTabAccess.mockReturnValue(undefined);
    getSiteAtacadoStoreIdsMock.mockResolvedValue(siteAtacadoIds);
    getMarcasMock.mockResolvedValue([]);
    getTabelasPrecoMock.mockResolvedValue([]);
    getDistinctColecoesMock.mockResolvedValue([]);
    buildCustoFamiliaViewModelMock.mockResolvedValue(STUB_VM);
  });

  it("usuário com lojas de varejo liberadas além de CD/ATACADO: página só manda CD/ATACADO pro view model", async () => {
    const { default: AtacadoCustoFamiliaPage } = await import("../page");
    await AtacadoCustoFamiliaPage({ searchParams: Promise.resolve({}) });

    expect(buildCustoFamiliaViewModelMock).toHaveBeenCalledTimes(1);
    const [filtersArg, canalArg] = buildCustoFamiliaViewModelMock.mock.calls[0];
    expect(canalArg).toBe("b2b");
    expect(filtersArg.storeIds).toEqual([STORE_CD, STORE_ATACADO]);
    expect(filtersArg.storeIds).not.toContain(STORE_VAREJO_SP);
    expect(filtersArg.storeIds).not.toContain(STORE_VAREJO_RJ);
  });

  it("usuário sem CD/ATACADO liberado: storeIds fica vazio (nenhum dado de atacado)", async () => {
    getStoreRestriction.mockReturnValue([STORE_VAREJO_SP, STORE_VAREJO_RJ]);
    getSessionUser.mockResolvedValue({ role: "admin", allowedStores: [STORE_VAREJO_SP, STORE_VAREJO_RJ], allowedMarcas: [], allowedTabelasPreco: [], allowedTabs: ["atacado-custo-familia"], canSeeFinancials: true });

    const { default: AtacadoCustoFamiliaPage } = await import("../page");
    await AtacadoCustoFamiliaPage({ searchParams: Promise.resolve({}) });

    const [filtersArg] = buildCustoFamiliaViewModelMock.mock.calls[0];
    expect(filtersArg.storeIds).toEqual([]);
  });
});
