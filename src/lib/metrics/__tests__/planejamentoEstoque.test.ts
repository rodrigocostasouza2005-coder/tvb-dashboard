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

// Reconciliação de totais (pedido explícito do Rodrigo, 2026-11-16): cenário com 2 cores × 2
// tamanhos × 2 posições (1 loja + 1 CD/Site) = 8 combinações. A soma de QUALQUER corte do
// detalhe (por cor→tamanho, por loja) tem que bater exatamente com o total do produto que
// getProdutosPlanejamento devolve na lista principal — nenhuma combinação pode sumir nem ser
// contada 2x entre os dois níveis (lista vs. detalhe).
describe("getProdutosPlanejamento × getProdutoPlanejamentoDetalhe — reconciliação de totais", () => {
  const CENARIO_8_COMBINACOES = [
    baseVariante({ cod: "AZ-P", cor: "Azul", tamanho: "P", porLoja: [
      { storeId: "loja-a", storeCode: "A", storeName: "Loja A", tipoPosicao: "loja", estoqueAtual: 3, vendasDias30: 0, vendasDias60: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" },
      { storeId: "cd", storeCode: "CD", storeName: "CD/Site", tipoPosicao: "cd_site", estoqueAtual: 7, vendasDias30: 0, vendasDias60: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" },
    ] }),
    baseVariante({ cod: "AZ-M", cor: "Azul", tamanho: "M", porLoja: [
      { storeId: "loja-a", storeCode: "A", storeName: "Loja A", tipoPosicao: "loja", estoqueAtual: 5, vendasDias30: 0, vendasDias60: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" },
      { storeId: "cd", storeCode: "CD", storeName: "CD/Site", tipoPosicao: "cd_site", estoqueAtual: 11, vendasDias30: 0, vendasDias60: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" },
    ] }),
    baseVariante({ cod: "VM-P", cor: "Vermelho", tamanho: "P", porLoja: [
      { storeId: "loja-a", storeCode: "A", storeName: "Loja A", tipoPosicao: "loja", estoqueAtual: 2, vendasDias30: 0, vendasDias60: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" },
      { storeId: "cd", storeCode: "CD", storeName: "CD/Site", tipoPosicao: "cd_site", estoqueAtual: 4, vendasDias30: 0, vendasDias60: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" },
    ] }),
    baseVariante({ cod: "VM-M", cor: "Vermelho", tamanho: "M", porLoja: [
      { storeId: "loja-a", storeCode: "A", storeName: "Loja A", tipoPosicao: "loja", estoqueAtual: 6, vendasDias30: 0, vendasDias60: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" },
      { storeId: "cd", storeCode: "CD", storeName: "CD/Site", tipoPosicao: "cd_site", estoqueAtual: 8, vendasDias30: 0, vendasDias60: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" },
    ] }),
  ];
  // Soma manual das 8 combinações (4 cods × 2 posições): 3+7+5+11+2+4+6+8 = 46.
  const TOTAL_ESPERADO = 46;

  beforeEach(() => {
    getComparacaoCompleta.mockResolvedValue({ variantes: CENARIO_8_COMBINACOES, posicoes: {}, colunas: [], gradePorProdutoPosicao: {} });
    saleGroupBy.mockResolvedValue([]);
  });

  it("soma por cor→tamanho do detalhe bate com o estoqueTotal da lista principal", async () => {
    const { getProdutosPlanejamento, getProdutoPlanejamentoDetalhe } = await import("../planejamento-estoque");
    const [listaProduto] = await getProdutosPlanejamento();
    const detalhe = await getProdutoPlanejamentoDetalhe("Camisa Polo");

    expect(listaProduto.estoqueTotal).toBe(TOTAL_ESPERADO);

    const somaDoDetalhePorCorTamanho = detalhe!.porCor.reduce(
      (soma, c) => soma + c.porTamanho.reduce((s, t) => s + t.estoqueTotal, 0),
      0
    );
    expect(somaDoDetalhePorCorTamanho).toBe(TOTAL_ESPERADO);
  });

  it("soma por loja/CD do detalhe bate com o estoqueTotal da lista principal, e CD+lojas bate com estoqueCD+estoqueLojas", async () => {
    const { getProdutosPlanejamento, getProdutoPlanejamentoDetalhe } = await import("../planejamento-estoque");
    const [listaProduto] = await getProdutosPlanejamento();
    const detalhe = await getProdutoPlanejamentoDetalhe("Camisa Polo");

    const somaPorLoja = detalhe!.porLoja.reduce((s, l) => s + l.estoqueAtual, 0);
    expect(somaPorLoja).toBe(TOTAL_ESPERADO);

    const cd = detalhe!.porLoja.find((l) => l.tipoPosicao === "cd_site")!;
    const loja = detalhe!.porLoja.find((l) => l.tipoPosicao === "loja")!;
    expect(cd.estoqueAtual).toBe(listaProduto.estoqueCD);
    expect(loja.estoqueAtual).toBe(listaProduto.estoqueLojas);
    expect(listaProduto.estoqueCD + listaProduto.estoqueLojas).toBe(TOTAL_ESPERADO);
  });

  it("cada cor individual soma certo (Azul = 3+7+5+11 = 26, Vermelho = 2+4+6+8 = 20) — nenhum SKU vaza pra cor errada", async () => {
    const { getProdutoPlanejamentoDetalhe } = await import("../planejamento-estoque");
    const detalhe = await getProdutoPlanejamentoDetalhe("Camisa Polo");

    const totalPorCor = (cor: string) =>
      detalhe!.porCor.find((c) => c.cor === cor)!.porTamanho.reduce((s, t) => s + t.estoqueTotal, 0);

    expect(totalPorCor("Azul")).toBe(26);
    expect(totalPorCor("Vermelho")).toBe(20);
    expect(totalPorCor("Azul") + totalPorCor("Vermelho")).toBe(TOTAL_ESPERADO);
  });
});

// Fase 2 (2026-11-16): tendência, demanda possivelmente mascarada, e a correção de
// coberturaDias/diagnostico por loja (antes vinha do primeiro cod visto, agora é o agregado real).
describe("getProdutosPlanejamento — Fase 2 (tendência, demanda mascarada)", () => {
  const hoje = new Date();
  const confiavelDesde = new Date(hoje.getTime() - 30 * 86_400_000); // 30 dias de histórico, >= 14 (confiável)

  function mockVendas(v30: number, v60: number, v90: number) {
    saleGroupBy
      .mockReset()
      .mockResolvedValueOnce([{ produto: "Camisa Polo", _sum: { quantidade: v30 } }]) // janela 30d
      .mockResolvedValueOnce([{ produto: "Camisa Polo", _sum: { quantidade: v60 } }]) // janela 60d
      .mockResolvedValueOnce([{ produto: "Camisa Polo", _sum: { quantidade: v90 } }]) // janela 90d
      .mockResolvedValueOnce([{ produto: "Camisa Polo", _min: { saleDate: confiavelDesde } }]); // histórico
  }

  it("tendência 'crescimento' quando vendasDias30 supera a janela anterior em mais de 20%", async () => {
    getComparacaoCompleta.mockResolvedValue({ variantes: [baseVariante()], posicoes: {}, colunas: [], gradePorProdutoPosicao: {} });
    mockVendas(30, 40, 50); // janela anterior (60-30) = 10; 30 > 10*1.2

    const { getProdutosPlanejamento } = await import("../planejamento-estoque");
    const [r] = await getProdutosPlanejamento();

    expect(r.tendencia).toBe("crescimento");
  });

  it("tendência 'desaceleracao' quando vendasDias30 cai mais de 20% da janela anterior", async () => {
    getComparacaoCompleta.mockResolvedValue({ variantes: [baseVariante()], posicoes: {}, colunas: [], gradePorProdutoPosicao: {} });
    mockVendas(5, 55, 60); // janela anterior (60-30) = 50; 5 < 50*0.8

    const { getProdutosPlanejamento } = await import("../planejamento-estoque");
    const [r] = await getProdutosPlanejamento();

    expect(r.tendencia).toBe("desaceleracao");
  });

  it("tendência 'estavel' quando a variação fica dentro de 20% pra cima ou pra baixo", async () => {
    getComparacaoCompleta.mockResolvedValue({ variantes: [baseVariante()], posicoes: {}, colunas: [], gradePorProdutoPosicao: {} });
    mockVendas(20, 40, 60); // janela anterior (60-20) = 20; 20 == 20 (dentro da faixa 0.8x-1.2x)

    const { getProdutosPlanejamento } = await import("../planejamento-estoque");
    const [r] = await getProdutosPlanejamento();

    expect(r.tendencia).toBe("estavel");
  });

  it("tendência 'sem_dado' quando não confiável (menos de 14 dias de histórico), nunca força crescimento/desaceleração sem base", async () => {
    getComparacaoCompleta.mockResolvedValue({ variantes: [baseVariante()], posicoes: {}, colunas: [], gradePorProdutoPosicao: {} });
    const seteDiasAtras = new Date(hoje.getTime() - 7 * 86_400_000);
    saleGroupBy
      .mockReset()
      .mockResolvedValueOnce([{ produto: "Camisa Polo", _sum: { quantidade: 100 } }])
      .mockResolvedValueOnce([{ produto: "Camisa Polo", _sum: { quantidade: 10 } }])
      .mockResolvedValueOnce([{ produto: "Camisa Polo", _sum: { quantidade: 10 } }])
      .mockResolvedValueOnce([{ produto: "Camisa Polo", _min: { saleDate: seteDiasAtras } }]);

    const { getProdutosPlanejamento } = await import("../planejamento-estoque");
    const [r] = await getProdutosPlanejamento();

    expect(r.tendencia).toBe("sem_dado");
  });

  it("demandaPossivelmenteMascarada é true em ruptura/cobertura_critica e NUNCA inventa um número de demanda — só o aviso booleano", async () => {
    getComparacaoCompleta.mockResolvedValue({
      variantes: [baseVariante({ porLoja: [{ storeId: "loja-a", storeCode: "A", storeName: "Loja A", tipoPosicao: "loja", estoqueAtual: 0, vendasDias30: 0, vendasDias60: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" }] })],
      posicoes: {}, colunas: [], gradePorProdutoPosicao: {},
    });
    mockVendas(0, 0, 10); // vendeu nos 90d, estoque zerado agora -> ruptura

    const { getProdutosPlanejamento } = await import("../planejamento-estoque");
    const [r] = await getProdutosPlanejamento();

    expect(r.situacao).toBe("ruptura");
    expect(r.demandaPossivelmenteMascarada).toBe(true);
    expect(typeof r.demandaPossivelmenteMascarada).toBe("boolean"); // nunca um número fabricado
  });

  it("demandaPossivelmenteMascarada é false quando a situação é equilibrada/excesso (estoque não é o fator limitante)", async () => {
    getComparacaoCompleta.mockResolvedValue({
      variantes: [baseVariante({ porLoja: [{ storeId: "loja-a", storeCode: "A", storeName: "Loja A", tipoPosicao: "loja", estoqueAtual: 1000, vendasDias30: 0, vendasDias60: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" }] })],
      posicoes: {}, colunas: [], gradePorProdutoPosicao: {},
    });
    mockVendas(10, 20, 30);

    const { getProdutosPlanejamento } = await import("../planejamento-estoque");
    const [r] = await getProdutosPlanejamento();

    expect(r.situacao).toBe("cobertura_excessiva");
    expect(r.demandaPossivelmenteMascarada).toBe(false);
  });
});

describe("getProdutoPlanejamentoDetalhe — Fase 2: correção da cobertura/diagnóstico por loja", () => {
  it("agrega vendasDias30/90 de TODOS os cods do produto por loja antes de calcular cobertura/diagnóstico (não usa mais o valor do primeiro cod visto)", async () => {
    // Produto com 2 cods na MESMA loja: o 1º tem vendasDias90=0 (pareceria ruptura isolado), o
    // 2º tem vendasDias90 alto e bastante estoque. Se o bug antigo (pegar só o 1º cod) ainda
    // existisse, o diagnóstico da loja sairia da leitura isolada do 1º cod; agregado correto, o
    // estoque do 2º cod garante cobertura saudável.
    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        baseVariante({ cod: "COD-1", cor: "Azul", porLoja: [{ storeId: "loja-a", storeCode: "A", storeName: "Loja A", tipoPosicao: "loja", estoqueAtual: 0, vendasDias30: 0, vendasDias60: 0, vendasDias90: 0, velocidadeDiaria: 0, coberturaDias: null, estoqueMinimo: null, diagnostico: "sem_dado" }] }),
        baseVariante({ cod: "COD-2", cor: "Vermelho", porLoja: [{ storeId: "loja-a", storeCode: "A", storeName: "Loja A", tipoPosicao: "loja", estoqueAtual: 900, vendasDias30: 3, vendasDias60: 6, vendasDias90: 9, velocidadeDiaria: 0.1, coberturaDias: 9000, estoqueMinimo: null, diagnostico: "cobertura_excessiva" }] }),
      ],
      posicoes: {}, colunas: [], gradePorProdutoPosicao: {},
    });

    const { getProdutoPlanejamentoDetalhe } = await import("../planejamento-estoque");
    const detalhe = await getProdutoPlanejamentoDetalhe("Camisa Polo");

    const loja = detalhe!.porLoja.find((l) => l.posicaoId === "loja-a")!;
    expect(loja.estoqueAtual).toBe(900); // 0 + 900, agregado
    expect(loja.vendasDias30).toBe(3); // 0 + 3, agregado
    expect(loja.vendasDias90).toBe(9); // 0 + 9, agregado
    expect(loja.diagnostico).toBe("cobertura_excessiva"); // reflete o AGREGADO, não o 1º cod (que seria "sem_dado")
  });
});
