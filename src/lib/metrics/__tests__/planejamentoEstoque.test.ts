import { describe, it, expect, vi, beforeEach } from "vitest";

const getComparacaoCompleta = vi.fn();
const getPedidosEmAbertoPorCod = vi.fn();
const getRecomendacoesBestSeller = vi.fn();
const getRecomendacoesDrop = vi.fn();
const getDailySalesByProduto = vi.fn();
const saleGroupBy = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { sale: { groupBy: (...a: unknown[]) => saleGroupBy(...a) } },
}));

// diagnosticarVariante é função pura (sem Prisma) — mantida real, não mockada, pra testar a
// integração de verdade com a mesma régua usada no resto do Radar.
vi.mock("../distribuicao-estoque", async (importActual) => {
  const actual = await importActual<typeof import("../distribuicao-estoque")>();
  return { ...actual, getComparacaoCompleta: (...a: unknown[]) => getComparacaoCompleta(...a) };
});

vi.mock("../compras-inteligencia", () => ({
  getPedidosEmAbertoPorCod: (...a: unknown[]) => getPedidosEmAbertoPorCod(...a),
  getRecomendacoesBestSeller: (...a: unknown[]) => getRecomendacoesBestSeller(...a),
  getRecomendacoesDrop: (...a: unknown[]) => getRecomendacoesDrop(...a),
}));

vi.mock("../vendas", () => ({
  getDailySalesByProduto: (...a: unknown[]) => getDailySalesByProduto(...a),
}));

function variante(overrides: Partial<Parameters<typeof baseVariante>[0]> = {}) {
  return baseVariante(overrides);
}
function baseVariante(overrides: Record<string, unknown> = {}) {
  return {
    cod: "COD-1",
    produto: "Camisa Polo",
    grupo: "Polos",
    cor: "Azul",
    tamanho: "M",
    colecao: null,
    tipoCompra: null,
    vendasSite90: 0,
    porLoja: [
      { storeId: "loja-a", storeCode: "A", storeName: "Loja A", tipoPosicao: "loja", estoqueAtual: 10, vendasDias30: 3, vendasDias60: 6, vendasDias90: 9, velocidadeDiaria: 0.1, coberturaDias: 100, estoqueMinimo: null, diagnostico: "equilibrado" },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  getComparacaoCompleta.mockReset();
  getPedidosEmAbertoPorCod.mockReset().mockResolvedValue(new Map());
  getRecomendacoesBestSeller.mockReset().mockResolvedValue([]);
  getRecomendacoesDrop.mockReset().mockResolvedValue([]);
  getDailySalesByProduto.mockReset().mockResolvedValue([]);
  saleGroupBy.mockReset();
});

describe("getProdutosPlanejamento", () => {
  it("agrega por produto (não por cod) somando estoque de todas as posições", async () => {
    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        baseVariante({ cod: "COD-1", tamanho: "P", porLoja: [{ storeId: "loja-a", storeCode: "A", storeName: "Loja A", tipoPosicao: "loja", estoqueAtual: 10, vendasDias30: 0, vendasDias60: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" }] }),
        baseVariante({ cod: "COD-2", tamanho: "M", porLoja: [{ storeId: "cd", storeCode: "CD", storeName: "CD/Site", tipoPosicao: "cd_site", estoqueAtual: 5, vendasDias30: 0, vendasDias60: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" }] }),
      ],
      posicoes: {}, colunas: [], gradePorProdutoPosicao: {},
    });
    saleGroupBy.mockResolvedValue([]);

    const { getProdutosPlanejamento } = await import("../planejamento-estoque");
    const result = await getProdutosPlanejamento();

    expect(result).toHaveLength(1);
    expect(result[0].produto).toBe("Camisa Polo");
    expect(result[0].estoqueTotal).toBe(15);
    expect(result[0].estoqueLojas).toBe(10);
    expect(result[0].estoqueCD).toBe(5);
    expect(result[0].cods).toEqual(expect.arrayContaining(["COD-1", "COD-2"]));
  });

  it("NUNCA soma porLoja[].vendasDias30 (evita contar 2x a demanda que o CD/Site já embute das lojas) — vendas vêm de uma query direta por produto", async () => {
    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        baseVariante({
          porLoja: [
            { storeId: "loja-a", storeCode: "A", storeName: "Loja A", tipoPosicao: "loja", estoqueAtual: 10, vendasDias30: 100, vendasDias60: 100, vendasDias90: 100, velocidadeDiaria: 1, coberturaDias: 10, estoqueMinimo: null, diagnostico: "equilibrado" },
            { storeId: "cd", storeCode: "CD", storeName: "CD/Site", tipoPosicao: "cd_site", estoqueAtual: 20, vendasDias30: 150, vendasDias60: 150, vendasDias90: 150, velocidadeDiaria: 1, coberturaDias: 20, estoqueMinimo: null, diagnostico: "equilibrado" },
          ],
        }),
      ],
      posicoes: {}, colunas: [], gradePorProdutoPosicao: {},
    });
    // Resposta real e independente da query direta de Sale por produto — não tem relação com os
    // números (propositalmente diferentes) do mock de porLoja acima, pra provar que a função usa
    // ESTA fonte, não a soma de porLoja.
    saleGroupBy.mockImplementation(({ where }: { where: { saleDate?: { gte: Date } } }) => {
      if (!where.saleDate) return Promise.resolve([{ produto: "Camisa Polo", _min: { saleDate: new Date("2026-01-01") } }]);
      return Promise.resolve([{ produto: "Camisa Polo", _sum: { quantidade: 42 } }]);
    });

    const { getProdutosPlanejamento } = await import("../planejamento-estoque");
    const result = await getProdutosPlanejamento();

    expect(result[0].vendasDias30).toBe(42);
    expect(result[0].vendasDias30).not.toBe(250); // 100 + 150, a soma errada que dobraria a contagem
  });

  it("classificação MISTO quando cods do mesmo produto têm tipoCompra diferente", async () => {
    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        baseVariante({ cod: "COD-1", tipoCompra: "BEST_SELLER" }),
        baseVariante({ cod: "COD-2", tipoCompra: "DROP" }),
      ],
      posicoes: {}, colunas: [], gradePorProdutoPosicao: {},
    });
    saleGroupBy.mockResolvedValue([]);

    const { getProdutosPlanejamento } = await import("../planejamento-estoque");
    const result = await getProdutosPlanejamento();

    expect(result[0].classificacao).toBe("MISTO");
  });

  it("classificação NAO_CLASSIFICADO quando nenhum cod tem tipoCompra", async () => {
    getComparacaoCompleta.mockResolvedValue({ variantes: [baseVariante({ tipoCompra: null })], posicoes: {}, colunas: [], gradePorProdutoPosicao: {} });
    saleGroupBy.mockResolvedValue([]);

    const { getProdutosPlanejamento } = await import("../planejamento-estoque");
    const result = await getProdutosPlanejamento();

    expect(result[0].classificacao).toBe("NAO_CLASSIFICADO");
  });

  it("cobertura null (\"dados insuficientes\") quando histórico de venda é menor que 14 dias", async () => {
    getComparacaoCompleta.mockResolvedValue({ variantes: [baseVariante()], posicoes: {}, colunas: [], gradePorProdutoPosicao: {} });
    const hoje = new Date();
    const seteDiasAtras = new Date(hoje.getTime() - 7 * 86_400_000);
    saleGroupBy.mockImplementation(({ where }: { where: { saleDate?: unknown } }) => {
      if (!where.saleDate) return Promise.resolve([{ produto: "Camisa Polo", _min: { saleDate: seteDiasAtras } }]);
      return Promise.resolve([{ produto: "Camisa Polo", _sum: { quantidade: 20 } }]);
    });

    const { getProdutosPlanejamento } = await import("../planejamento-estoque");
    const result = await getProdutosPlanejamento();

    expect(result[0].confiavel).toBe(false);
    expect(result[0].coberturaDias).toBeNull();
    expect(result[0].velocidadeDiaria).toBe(0);
  });

  it("quantidade em trânsito nunca entra no estoqueTotal e expõe transitoConfiavel=false (ProductionOrder sem ETA)", async () => {
    getComparacaoCompleta.mockResolvedValue({ variantes: [baseVariante({ porLoja: [{ storeId: "loja-a", storeCode: "A", storeName: "Loja A", tipoPosicao: "loja", estoqueAtual: 7, vendasDias30: 0, vendasDias60: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" }] })], posicoes: {}, colunas: [], gradePorProdutoPosicao: {} });
    saleGroupBy.mockResolvedValue([]);
    getPedidosEmAbertoPorCod.mockResolvedValue(new Map([["COD-1", [{ quantidade: 50, dataPrevista: null, confiavel: false, origem: "Ordem de produção em aberto" }]]]));

    const { getProdutosPlanejamento } = await import("../planejamento-estoque");
    const result = await getProdutosPlanejamento();

    expect(result[0].estoqueTotal).toBe(7);
    expect(result[0].quantidadeEmTransito).toBe(50);
    expect(result[0].transitoConfiavel).toBe(false);
  });

  it("necessidadeReposicao verdadeira só em ruptura/cobertura_critica, nunca em excesso/parado/equilibrado", async () => {
    getComparacaoCompleta.mockResolvedValue({ variantes: [baseVariante({ porLoja: [{ storeId: "loja-a", storeCode: "A", storeName: "Loja A", tipoPosicao: "loja", estoqueAtual: 0, vendasDias30: 10, vendasDias60: 10, vendasDias90: 10, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" }] })], posicoes: {}, colunas: [], gradePorProdutoPosicao: {} });
    const hoje = new Date();
    const noventaDiasAtras = new Date(hoje.getTime() - 90 * 86_400_000);
    saleGroupBy.mockImplementation(({ where }: { where: { saleDate?: unknown } }) => {
      if (!where.saleDate) return Promise.resolve([{ produto: "Camisa Polo", _min: { saleDate: noventaDiasAtras } }]);
      return Promise.resolve([{ produto: "Camisa Polo", _sum: { quantidade: 30 } }]);
    });

    const { getProdutosPlanejamento } = await import("../planejamento-estoque");
    const result = await getProdutosPlanejamento();

    expect(result[0].situacao).toBe("ruptura"); // estoqueAtual=0, vendasDias90>0
    expect(result[0].necessidadeReposicao).toBe(true);
  });
});

describe("getProdutoPlanejamentoDetalhe", () => {
  it("nunca soma tamanhos de cores diferentes na mesma linha (curva de tamanho por cor)", async () => {
    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        baseVariante({ cod: "COD-AZUL-M", cor: "Azul", tamanho: "M", porLoja: [{ storeId: "loja-a", storeCode: "A", storeName: "Loja A", tipoPosicao: "loja", estoqueAtual: 10, vendasDias30: 0, vendasDias60: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" }] }),
        baseVariante({ cod: "COD-VERMELHO-M", cor: "Vermelho", tamanho: "M", porLoja: [{ storeId: "loja-a", storeCode: "A", storeName: "Loja A", tipoPosicao: "loja", estoqueAtual: 999, vendasDias30: 0, vendasDias60: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" }] }),
      ],
      posicoes: {}, colunas: [], gradePorProdutoPosicao: {},
    });

    const { getProdutoPlanejamentoDetalhe } = await import("../planejamento-estoque");
    const detalhe = await getProdutoPlanejamentoDetalhe("Camisa Polo");

    expect(detalhe).not.toBeNull();
    const azul = detalhe!.porCor.find((c) => c.cor === "Azul")!;
    const vermelho = detalhe!.porCor.find((c) => c.cor === "Vermelho")!;
    expect(azul.porTamanho.find((t) => t.tamanho === "M")!.estoqueTotal).toBe(10);
    expect(vermelho.porTamanho.find((t) => t.tamanho === "M")!.estoqueTotal).toBe(999);
  });

  it("devolve null quando o produto não existe nas variantes", async () => {
    getComparacaoCompleta.mockResolvedValue({ variantes: [], posicoes: {}, colunas: [], gradePorProdutoPosicao: {} });

    const { getProdutoPlanejamentoDetalhe } = await import("../planejamento-estoque");
    const detalhe = await getProdutoPlanejamentoDetalhe("Produto Inexistente");

    expect(detalhe).toBeNull();
  });
});
