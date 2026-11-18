import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VariantePorLoja } from "../distribuicao-estoque";

const getComparacaoCompleta = vi.fn();
const getVendaMediaDiariaPorCod = vi.fn();
const estoqueMinimoManualFindMany = vi.fn();
const classificacaoProdutoFindMany = vi.fn();
const productionOrderFindMany = vi.fn();
const estoqueMinimoManualFindUnique = vi.fn();
const estoqueMinimoManualUpsert = vi.fn();
const estoqueMinimoManualHistoricoCreate = vi.fn();

// getComparacaoCompleta é mockada (camada de DADO) — o teste nunca recalcula a lógica dela, só
// controla o que ela devolve. Mesmo padrão de planejamentoDistribuicao.test.ts.
vi.mock("../distribuicao-estoque", async (importActual) => {
  const actual = await importActual<typeof import("../distribuicao-estoque")>();
  return {
    ...actual,
    getComparacaoCompleta: (...a: unknown[]) => getComparacaoCompleta(...a),
  };
});

vi.mock("../compras-inteligencia", () => ({
  getVendaMediaDiariaPorCod: (...a: unknown[]) => getVendaMediaDiariaPorCod(...a),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    estoqueMinimoManual: {
      findMany: (...a: unknown[]) => estoqueMinimoManualFindMany(...a),
      findUnique: (...a: unknown[]) => estoqueMinimoManualFindUnique(...a),
      upsert: (...a: unknown[]) => estoqueMinimoManualUpsert(...a),
    },
    estoqueMinimoManualHistorico: { create: (...a: unknown[]) => estoqueMinimoManualHistoricoCreate(...a) },
    classificacaoProduto: { findMany: (...a: unknown[]) => classificacaoProdutoFindMany(...a) },
    productionOrder: { findMany: (...a: unknown[]) => productionOrderFindMany(...a) },
  },
}));

function loja(overrides: Partial<VariantePorLoja> = {}): VariantePorLoja {
  return {
    storeId: "loja-a",
    storeCode: "A",
    storeName: "Loja A",
    tipoPosicao: "loja",
    estoqueAtual: 0,
    vendasDias30: 0,
    vendasDias60: 0,
    vendasDias90: 0,
    velocidadeDiaria: 0,
    coberturaDias: null,
    estoqueMinimo: null,
    diagnostico: "sem_dado",
    ...overrides,
  };
}

function cd(overrides: Partial<VariantePorLoja> = {}): VariantePorLoja {
  return loja({ storeId: "cd", storeCode: "CD", storeName: "CD/Site", tipoPosicao: "cd_site", ...overrides });
}

function variante(overrides: Record<string, unknown> = {}) {
  return {
    cod: "COD-1",
    produto: "Camisa Polo",
    grupo: "Polos",
    cor: "Azul",
    tamanho: "M",
    colecao: null,
    tipoCompra: null,
    vendasSite90: 0,
    porLoja: [loja()],
    ...overrides,
  };
}

beforeEach(() => {
  getComparacaoCompleta.mockReset().mockResolvedValue({ variantes: [], posicoes: {}, colunas: [], gradePorProdutoPosicao: {} });
  getVendaMediaDiariaPorCod.mockReset().mockResolvedValue(new Map());
  estoqueMinimoManualFindMany.mockReset().mockResolvedValue([]);
  classificacaoProdutoFindMany.mockReset().mockResolvedValue([]);
  productionOrderFindMany.mockReset().mockResolvedValue([]);
  estoqueMinimoManualFindUnique.mockReset().mockResolvedValue(null);
  estoqueMinimoManualUpsert.mockReset();
  estoqueMinimoManualHistoricoCreate.mockReset();
});

describe("calcularNivelAlertaMinimoManual (pura)", () => {
  it("CRITICO quando estoque consolidado < mínimo definido", async () => {
    const { calcularNivelAlertaMinimoManual } = await import("../estoque-minimo-manual");
    const nivel = calcularNivelAlertaMinimoManual({
      minimoDefinido: 100,
      estoqueConsolidado: 50,
      diasAteCruzarMinimo: null,
      tempoMedioProducaoDias: null,
    });
    expect(nivel).toBe("CRITICO");
  });

  it("SEM_MINIMO_DEFINIDO quando mínimo é null, independente do estoque", async () => {
    const { calcularNivelAlertaMinimoManual } = await import("../estoque-minimo-manual");
    const nivel = calcularNivelAlertaMinimoManual({
      minimoDefinido: null,
      estoqueConsolidado: 0,
      diasAteCruzarMinimo: null,
      tempoMedioProducaoDias: 5,
    });
    expect(nivel).toBe("SEM_MINIMO_DEFINIDO");
  });

  it("ATENCAO quando estoque >= mínimo mas diasAteCruzarMinimo <= tempoMedioProducaoDias", async () => {
    const { calcularNivelAlertaMinimoManual } = await import("../estoque-minimo-manual");
    const nivel = calcularNivelAlertaMinimoManual({
      minimoDefinido: 100,
      estoqueConsolidado: 110,
      diasAteCruzarMinimo: 5,
      tempoMedioProducaoDias: 10,
    });
    expect(nivel).toBe("ATENCAO");
  });

  it("NORMAL quando estoque confortável (diasAteCruzarMinimo bem maior que tempoMedioProducaoDias)", async () => {
    const { calcularNivelAlertaMinimoManual } = await import("../estoque-minimo-manual");
    const nivel = calcularNivelAlertaMinimoManual({
      minimoDefinido: 100,
      estoqueConsolidado: 500,
      diasAteCruzarMinimo: 200,
      tempoMedioProducaoDias: 10,
    });
    expect(nivel).toBe("NORMAL");
  });

  it("NORMAL (nunca ATENCAO inventado) quando tempoMedioProducaoDias é null, mesmo com diasAteCruzarMinimo baixo", async () => {
    const { calcularNivelAlertaMinimoManual } = await import("../estoque-minimo-manual");
    const nivel = calcularNivelAlertaMinimoManual({
      minimoDefinido: 100,
      estoqueConsolidado: 110,
      diasAteCruzarMinimo: 1,
      tempoMedioProducaoDias: null,
    });
    expect(nivel).toBe("NORMAL");
  });
});

describe("getEstoqueMinimoManual (camada de dado, tudo mockado)", () => {
  it("soma estoqueAtual de todas as posições corretamente — dobrar venda numa loja não muda o estoque consolidado", async () => {
    estoqueMinimoManualFindMany.mockResolvedValue([{ cod: "COD-1", valor: 50 }]);
    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        variante({
          porLoja: [
            loja({ storeId: "loja-a", estoqueAtual: 10, vendasDias30: 5 }),
            loja({ storeId: "loja-b", estoqueAtual: 20, vendasDias30: 7 }),
            cd({ estoqueAtual: 30, vendasDias30: 9 }),
          ],
        }),
      ],
      posicoes: {},
      colunas: [],
      gradePorProdutoPosicao: {},
    });
    getVendaMediaDiariaPorCod.mockResolvedValue(new Map([["COD-1", { mediaDiaria: 2, diasComDado: 56 }]]));

    const { getEstoqueMinimoManual } = await import("../estoque-minimo-manual");
    const itensBase = await getEstoqueMinimoManual();
    expect(itensBase).toHaveLength(1);
    expect(itensBase[0].estoqueConsolidado).toBe(60); // 10 + 20 + 30

    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        variante({
          porLoja: [
            loja({ storeId: "loja-a", estoqueAtual: 10, vendasDias30: 10 }), // dobrou
            loja({ storeId: "loja-b", estoqueAtual: 20, vendasDias30: 7 }),
            cd({ estoqueAtual: 30, vendasDias30: 9 }),
          ],
        }),
      ],
      posicoes: {},
      colunas: [],
      gradePorProdutoPosicao: {},
    });
    const itensDepois = await getEstoqueMinimoManual();
    expect(itensDepois[0].estoqueConsolidado).toBe(60); // inalterado
  });

  it("cod sem ProductionOrder elegível tem tempoMedioProducaoDias null", async () => {
    estoqueMinimoManualFindMany.mockResolvedValue([{ cod: "COD-1", valor: 50 }]);
    getComparacaoCompleta.mockResolvedValue({
      variantes: [variante({ porLoja: [loja({ estoqueAtual: 100 })] })],
      posicoes: {},
      colunas: [],
      gradePorProdutoPosicao: {},
    });
    getVendaMediaDiariaPorCod.mockResolvedValue(new Map([["COD-1", { mediaDiaria: 1, diasComDado: 56 }]]));
    productionOrderFindMany.mockResolvedValue([]);

    const { getEstoqueMinimoManual } = await import("../estoque-minimo-manual");
    const itens = await getEstoqueMinimoManual();
    expect(itens[0].tempoMedioProducaoDias).toBeNull();
  });

  it("calcula tempoMedioProducaoDias como média de (dataFinalizacaoProducao - dataEntradaCelula) por cod", async () => {
    estoqueMinimoManualFindMany.mockResolvedValue([{ cod: "COD-1", valor: 50 }]);
    getComparacaoCompleta.mockResolvedValue({
      variantes: [variante({ porLoja: [loja({ estoqueAtual: 100 })] })],
      posicoes: {},
      colunas: [],
      gradePorProdutoPosicao: {},
    });
    getVendaMediaDiariaPorCod.mockResolvedValue(new Map([["COD-1", { mediaDiaria: 1, diasComDado: 56 }]]));
    const dia = 86_400_000;
    productionOrderFindMany.mockResolvedValue([
      { cod: "COD-1", dataEntradaCelula: new Date(0), dataFinalizacaoProducao: new Date(10 * dia) },
      { cod: "COD-1", dataEntradaCelula: new Date(0), dataFinalizacaoProducao: new Date(20 * dia) },
    ]);

    const { getEstoqueMinimoManual } = await import("../estoque-minimo-manual");
    const itens = await getEstoqueMinimoManual();
    expect(itens[0].tempoMedioProducaoDias).toBe(15); // média de 10 e 20
  });

  it("inclui QUALQUER SKU (não só Best Seller) — produto não classificado também aparece, sem mínimo inventado", async () => {
    // Nenhum mínimo cadastrado, nenhuma classificação — mesmo assim o cod aparece no resultado.
    getComparacaoCompleta.mockResolvedValue({
      variantes: [variante({ cod: "NAO-CLASSIFICADO-1", produto: "Produto Sem Classificação", porLoja: [loja({ estoqueAtual: 5 })] })],
      posicoes: {},
      colunas: [],
      gradePorProdutoPosicao: {},
    });

    const { getEstoqueMinimoManual } = await import("../estoque-minimo-manual");
    const itens = await getEstoqueMinimoManual();
    expect(itens).toHaveLength(1);
    expect(itens[0].cod).toBe("NAO-CLASSIFICADO-1");
    expect(itens[0].tipoCompra).toBeNull();
    expect(itens[0].minimoDefinido).toBeNull();
    expect(itens[0].nivelAlerta).toBe("SEM_MINIMO_DEFINIDO");
  });

  it("expõe tipoCompra do cod (Best Seller/Drop) só como contexto, sem afetar o cálculo do mínimo", async () => {
    estoqueMinimoManualFindMany.mockResolvedValue([{ cod: "DROP-1", valor: 10 }]);
    classificacaoProdutoFindMany.mockResolvedValue([{ cod: "DROP-1", tipoCompra: "DROP" }]);
    getComparacaoCompleta.mockResolvedValue({
      variantes: [variante({ cod: "DROP-1", produto: "Produto Drop", tipoCompra: "DROP", porLoja: [loja({ estoqueAtual: 20 })] })],
      posicoes: {},
      colunas: [],
      gradePorProdutoPosicao: {},
    });

    const { getEstoqueMinimoManual } = await import("../estoque-minimo-manual");
    const itens = await getEstoqueMinimoManual();
    expect(itens[0].tipoCompra).toBe("DROP");
    expect(itens[0].nivelAlerta).toBe("NORMAL"); // 20 >= 10, sem relação com ser Drop
  });

  it("ordena CRITICO -> ATENCAO -> SEM_MINIMO_DEFINIDO -> NORMAL", async () => {
    estoqueMinimoManualFindMany.mockResolvedValue([
      { cod: "NORMAL-1", valor: 10 },
      { cod: "CRIT-1", valor: 100 },
      { cod: "ATENCAO-1", valor: 50 },
    ]);
    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        variante({ cod: "NORMAL-1", produto: "Z Normal", porLoja: [loja({ estoqueAtual: 1000 })] }),
        variante({ cod: "SEM-MIN-1", produto: "Y SemMinimo", porLoja: [loja({ estoqueAtual: 10 })] }),
        variante({ cod: "CRIT-1", produto: "X Critico", porLoja: [loja({ estoqueAtual: 10 })] }), // < 100
        variante({ cod: "ATENCAO-1", produto: "W Atencao", porLoja: [loja({ estoqueAtual: 55 })] }), // >= 50
      ],
      posicoes: {},
      colunas: [],
      gradePorProdutoPosicao: {},
    });
    getVendaMediaDiariaPorCod.mockResolvedValue(
      new Map([
        ["NORMAL-1", { mediaDiaria: 1, diasComDado: 56 }],
        ["SEM-MIN-1", { mediaDiaria: 1, diasComDado: 56 }],
        ["CRIT-1", { mediaDiaria: 1, diasComDado: 56 }],
        ["ATENCAO-1", { mediaDiaria: 1, diasComDado: 56 }], // diasAteCruzarMinimo = 5
      ])
    );
    const dia = 86_400_000;
    productionOrderFindMany.mockResolvedValue([
      { cod: "ATENCAO-1", dataEntradaCelula: new Date(0), dataFinalizacaoProducao: new Date(10 * dia) },
    ]);

    const { getEstoqueMinimoManual } = await import("../estoque-minimo-manual");
    const itens = await getEstoqueMinimoManual();

    expect(itens.map((i) => i.nivelAlerta)).toEqual(["CRITICO", "ATENCAO", "SEM_MINIMO_DEFINIDO", "NORMAL"]);
    expect(itens.map((i) => i.cod)).toEqual(["CRIT-1", "ATENCAO-1", "SEM-MIN-1", "NORMAL-1"]);
  });
});

describe("atualizarEstoqueMinimoManual", () => {
  it("cria registro novo (primeira definição) e grava histórico com valorAnterior null", async () => {
    estoqueMinimoManualFindUnique.mockResolvedValue(null);
    estoqueMinimoManualUpsert.mockResolvedValue({ id: "id-1", cod: "COD-1", valor: 30 });

    const { atualizarEstoqueMinimoManual } = await import("../estoque-minimo-manual");
    await atualizarEstoqueMinimoManual("COD-1", 30, "rodrigo@tvb.com");

    expect(estoqueMinimoManualHistoricoCreate).toHaveBeenCalledWith({
      data: { estoqueMinimoManualId: "id-1", valorAnterior: null, valorNovo: 30, alteradoPor: "rodrigo@tvb.com" },
    });
  });

  it("atualiza registro existente e grava histórico com valorAnterior real — nunca grava quando o valor não mudou", async () => {
    estoqueMinimoManualFindUnique.mockResolvedValue({ id: "id-1", cod: "COD-1", valor: 20 });
    estoqueMinimoManualUpsert.mockResolvedValue({ id: "id-1", cod: "COD-1", valor: 35 });

    const { atualizarEstoqueMinimoManual } = await import("../estoque-minimo-manual");
    await atualizarEstoqueMinimoManual("COD-1", 35, "rodrigo@tvb.com");
    expect(estoqueMinimoManualHistoricoCreate).toHaveBeenCalledWith({
      data: { estoqueMinimoManualId: "id-1", valorAnterior: 20, valorNovo: 35, alteradoPor: "rodrigo@tvb.com" },
    });

    estoqueMinimoManualHistoricoCreate.mockClear();
    estoqueMinimoManualFindUnique.mockResolvedValue({ id: "id-1", cod: "COD-1", valor: 35 });
    estoqueMinimoManualUpsert.mockResolvedValue({ id: "id-1", cod: "COD-1", valor: 35 });
    await atualizarEstoqueMinimoManual("COD-1", 35, "rodrigo@tvb.com"); // mesmo valor
    expect(estoqueMinimoManualHistoricoCreate).not.toHaveBeenCalled();
  });

  it("valor=null remove o mínimo (volta a 'sem mínimo definido') sem deletar a linha, preservando histórico", async () => {
    estoqueMinimoManualFindUnique.mockResolvedValue({ id: "id-1", cod: "COD-1", valor: 35 });
    estoqueMinimoManualUpsert.mockResolvedValue({ id: "id-1", cod: "COD-1", valor: null });

    const { atualizarEstoqueMinimoManual } = await import("../estoque-minimo-manual");
    await atualizarEstoqueMinimoManual("COD-1", null, "rodrigo@tvb.com");

    expect(estoqueMinimoManualUpsert).toHaveBeenCalledWith({
      where: { cod: "COD-1" },
      create: { cod: "COD-1", valor: null, atualizadoPor: "rodrigo@tvb.com" },
      update: { valor: null, atualizadoPor: "rodrigo@tvb.com" },
    });
    expect(estoqueMinimoManualHistoricoCreate).toHaveBeenCalledWith({
      data: { estoqueMinimoManualId: "id-1", valorAnterior: 35, valorNovo: null, alteradoPor: "rodrigo@tvb.com" },
    });
  });
});
