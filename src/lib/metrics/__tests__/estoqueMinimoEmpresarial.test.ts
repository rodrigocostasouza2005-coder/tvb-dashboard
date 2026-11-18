import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VariantePorLoja } from "../distribuicao-estoque";

const getComparacaoCompleta = vi.fn();
const getVendaMediaDiariaPorCod = vi.fn();
const classificacaoProdutoFindMany = vi.fn();
const productionOrderFindMany = vi.fn();

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
    tipoCompra: "BEST_SELLER",
    vendasSite90: 0,
    porLoja: [loja()],
    ...overrides,
  };
}

beforeEach(() => {
  getComparacaoCompleta.mockReset().mockResolvedValue({ variantes: [], posicoes: {}, colunas: [], gradePorProdutoPosicao: {} });
  getVendaMediaDiariaPorCod.mockReset().mockResolvedValue(new Map());
  classificacaoProdutoFindMany.mockReset().mockResolvedValue([]);
  productionOrderFindMany.mockReset().mockResolvedValue([]);
});

describe("calcularNivelAlertaMinimoEmpresarial (pura)", () => {
  it("CRITICO quando estoque consolidado < mínimo definido", async () => {
    const { calcularNivelAlertaMinimoEmpresarial } = await import("../estoque-minimo-empresarial");
    const nivel = calcularNivelAlertaMinimoEmpresarial({
      minimoDefinido: 100,
      estoqueConsolidado: 50,
      diasAteCruzarMinimo: null,
      tempoMedioProducaoDias: null,
    });
    expect(nivel).toBe("CRITICO");
  });

  it("SEM_MINIMO_DEFINIDO quando mínimo é null, independente do estoque", async () => {
    const { calcularNivelAlertaMinimoEmpresarial } = await import("../estoque-minimo-empresarial");
    const nivel = calcularNivelAlertaMinimoEmpresarial({
      minimoDefinido: null,
      estoqueConsolidado: 0,
      diasAteCruzarMinimo: null,
      tempoMedioProducaoDias: 5,
    });
    expect(nivel).toBe("SEM_MINIMO_DEFINIDO");
  });

  it("ATENCAO quando estoque >= mínimo mas diasAteCruzarMinimo <= tempoMedioProducaoDias", async () => {
    const { calcularNivelAlertaMinimoEmpresarial } = await import("../estoque-minimo-empresarial");
    const nivel = calcularNivelAlertaMinimoEmpresarial({
      minimoDefinido: 100,
      estoqueConsolidado: 110, // acima do mínimo, não é CRITICO
      diasAteCruzarMinimo: 5,
      tempoMedioProducaoDias: 10, // produção demora mais que o tempo até cruzar o mínimo
    });
    expect(nivel).toBe("ATENCAO");
  });

  it("NORMAL quando estoque confortável (diasAteCruzarMinimo bem maior que tempoMedioProducaoDias)", async () => {
    const { calcularNivelAlertaMinimoEmpresarial } = await import("../estoque-minimo-empresarial");
    const nivel = calcularNivelAlertaMinimoEmpresarial({
      minimoDefinido: 100,
      estoqueConsolidado: 500,
      diasAteCruzarMinimo: 200,
      tempoMedioProducaoDias: 10,
    });
    expect(nivel).toBe("NORMAL");
  });

  it("NORMAL (nunca ATENCAO inventado) quando tempoMedioProducaoDias é null, mesmo com diasAteCruzarMinimo baixo", async () => {
    const { calcularNivelAlertaMinimoEmpresarial } = await import("../estoque-minimo-empresarial");
    const nivel = calcularNivelAlertaMinimoEmpresarial({
      minimoDefinido: 100,
      estoqueConsolidado: 110,
      diasAteCruzarMinimo: 1, // seria ATENCAO claro se houvesse tempoMedioProducaoDias
      tempoMedioProducaoDias: null, // sem dado suficiente — não pode adivinhar
    });
    expect(nivel).toBe("NORMAL");
  });
});

describe("getEstoqueMinimoEmpresarial (camada de dado, tudo mockado)", () => {
  it("soma estoqueAtual de todas as posições corretamente — dobrar venda numa loja não muda o estoque consolidado", async () => {
    classificacaoProdutoFindMany.mockResolvedValue([{ cod: "COD-1", estoqueMinimoEmpresarial: 50 }]);
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

    const { getEstoqueMinimoEmpresarial } = await import("../estoque-minimo-empresarial");
    const itensBase = await getEstoqueMinimoEmpresarial();
    expect(itensBase).toHaveLength(1);
    expect(itensBase[0].estoqueConsolidado).toBe(60); // 10 + 20 + 30

    // Dobra a venda em uma das lojas (vendasDias30) sem tocar estoqueAtual — o consolidado de
    // ESTOQUE não pode mudar, prova de que a soma nunca usa porLoja[].vendasDiasXX/velocidadeDiaria.
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
    const itensDepois = await getEstoqueMinimoEmpresarial();
    expect(itensDepois[0].estoqueConsolidado).toBe(60); // inalterado
  });

  it("cod sem ProductionOrder elegível tem tempoMedioProducaoDias null", async () => {
    classificacaoProdutoFindMany.mockResolvedValue([{ cod: "COD-1", estoqueMinimoEmpresarial: 50 }]);
    getComparacaoCompleta.mockResolvedValue({
      variantes: [variante({ porLoja: [loja({ estoqueAtual: 100 })] })],
      posicoes: {},
      colunas: [],
      gradePorProdutoPosicao: {},
    });
    getVendaMediaDiariaPorCod.mockResolvedValue(new Map([["COD-1", { mediaDiaria: 1, diasComDado: 56 }]]));
    productionOrderFindMany.mockResolvedValue([]); // nenhuma ordem elegível

    const { getEstoqueMinimoEmpresarial } = await import("../estoque-minimo-empresarial");
    const itens = await getEstoqueMinimoEmpresarial();
    expect(itens[0].tempoMedioProducaoDias).toBeNull();
  });

  it("calcula tempoMedioProducaoDias como média de (dataFinalizacaoProducao - dataEntradaCelula) por cod", async () => {
    classificacaoProdutoFindMany.mockResolvedValue([{ cod: "COD-1", estoqueMinimoEmpresarial: 50 }]);
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

    const { getEstoqueMinimoEmpresarial } = await import("../estoque-minimo-empresarial");
    const itens = await getEstoqueMinimoEmpresarial();
    expect(itens[0].tempoMedioProducaoDias).toBe(15); // média de 10 e 20
  });

  it("produto não-Best-Seller nunca aparece no resultado", async () => {
    // classificacaoProduto.findMany já é filtrado por tipoCompra: BEST_SELLER no código real —
    // o mock aqui simula exatamente esse filtro: só devolve o cod Best Seller.
    classificacaoProdutoFindMany.mockResolvedValue([{ cod: "BS-1", estoqueMinimoEmpresarial: 10 }]);
    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        variante({ cod: "BS-1", produto: "Produto Best Seller", porLoja: [loja({ estoqueAtual: 5 })] }),
        variante({ cod: "DROP-1", produto: "Produto Drop", tipoCompra: "DROP", porLoja: [loja({ estoqueAtual: 999 })] }),
      ],
      posicoes: {},
      colunas: [],
      gradePorProdutoPosicao: {},
    });
    getVendaMediaDiariaPorCod.mockResolvedValue(new Map([["BS-1", { mediaDiaria: 1, diasComDado: 10 }]]));

    const { getEstoqueMinimoEmpresarial } = await import("../estoque-minimo-empresarial");
    const itens = await getEstoqueMinimoEmpresarial();
    expect(itens).toHaveLength(1);
    expect(itens[0].cod).toBe("BS-1");
    expect(itens.some((i) => i.cod === "DROP-1")).toBe(false);
  });

  it("ordena CRITICO -> ATENCAO -> SEM_MINIMO_DEFINIDO -> NORMAL", async () => {
    classificacaoProdutoFindMany.mockResolvedValue([
      { cod: "NORMAL-1", estoqueMinimoEmpresarial: 10 },
      { cod: "SEM-MIN-1", estoqueMinimoEmpresarial: null },
      { cod: "CRIT-1", estoqueMinimoEmpresarial: 100 },
      { cod: "ATENCAO-1", estoqueMinimoEmpresarial: 50 },
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
        ["NORMAL-1", { mediaDiaria: 1, diasComDado: 56 }], // diasAteCruzarMinimo bem alto
        ["SEM-MIN-1", { mediaDiaria: 1, diasComDado: 56 }],
        ["CRIT-1", { mediaDiaria: 1, diasComDado: 56 }],
        ["ATENCAO-1", { mediaDiaria: 1, diasComDado: 56 }], // diasAteCruzarMinimo = 5
      ])
    );
    // ATENCAO-1 precisa de tempoMedioProducaoDias >= diasAteCruzarMinimo (5) pra virar ATENCAO.
    const dia = 86_400_000;
    productionOrderFindMany.mockResolvedValue([
      { cod: "ATENCAO-1", dataEntradaCelula: new Date(0), dataFinalizacaoProducao: new Date(10 * dia) },
    ]);

    const { getEstoqueMinimoEmpresarial } = await import("../estoque-minimo-empresarial");
    const itens = await getEstoqueMinimoEmpresarial();

    expect(itens.map((i) => i.nivelAlerta)).toEqual(["CRITICO", "ATENCAO", "SEM_MINIMO_DEFINIDO", "NORMAL"]);
    expect(itens.map((i) => i.cod)).toEqual(["CRIT-1", "ATENCAO-1", "SEM-MIN-1", "NORMAL-1"]);
  });
});
