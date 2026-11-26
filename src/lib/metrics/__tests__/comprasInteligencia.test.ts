import { describe, it, expect, vi, beforeEach } from "vitest";
import { PossibilidadeReposicao, StatusComercialProduto, TipoCompraProduto } from "@prisma/client";
import {
  calcularSugestaoBestSeller,
  calcularSugestaoDrop,
  priorizarOrcamentoCompras,
  resolverTipoCompraProduto,
  resolverTipoCompraEfetivo,
  upsertClassificacaoProduto,
  type InputBestSeller,
  type InputDrop,
  type ClassificacaoInput,
  type ItemPriorizavel,
} from "../compras-inteligencia";

// Mock de Prisma só para o describe "getRecomendacoesDrop (ciclo ativo)" abaixo — as demais
// describes deste arquivo testam só funções puras (sem Prisma). vi.mock é hoisted pelo Vitest,
// então pode ficar aqui sem afetar a ordem de execução dos outros testes.
const classificacaoFindMany = vi.fn();
const saleGroupBy = vi.fn();
const returnGroupBy = vi.fn();
const stockSnapshotGroupBy = vi.fn();
const productionOrderGroupBy = vi.fn();
const classificacaoFindUnique = vi.fn();
const classificacaoUpsert = vi.fn();
const classificacaoHistoricoCreateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    classificacaoProduto: {
      findMany: (...a: unknown[]) => classificacaoFindMany(...a),
      findUnique: (...a: unknown[]) => classificacaoFindUnique(...a),
      upsert: (...a: unknown[]) => classificacaoUpsert(...a),
    },
    classificacaoProdutoHistorico: { createMany: (...a: unknown[]) => classificacaoHistoricoCreateMany(...a) },
    sale: { groupBy: (...a: unknown[]) => saleGroupBy(...a) },
    // Líquida de devolução (achado 1, auditoria 2026-11-26) — default [] em todo teste que não
    // configura devolução explicitamente, pra manter o comportamento antigo (sem devolução = sem
    // mudança no número bruto já esperado pelos cenários existentes).
    return: { groupBy: (...a: unknown[]) => returnGroupBy(...a) },
    stockSnapshot: { groupBy: (...a: unknown[]) => stockSnapshotGroupBy(...a) },
    productionOrder: { groupBy: (...a: unknown[]) => productionOrderGroupBy(...a) },
  },
}));

const baseBestSeller: InputBestSeller = {
  cod: "COD-1",
  grupo: "Camisetas",
  horizonteCoberturaDias: 30,
  vendaMediaDiaria: 2,
  diasHistoricoDisponivel: 60,
  estoqueDisponivel: 100,
  estoqueSegurancaUnidades: 10,
  leadTimeDias: 15,
};

const baseDrop: InputDrop = {
  cod: "COD-DROP-1",
  colecao: "Drop Verão 26",
  grupo: "Camisetas",
  possibilidadeReposicao: PossibilidadeReposicao.SIM,
  quantidadeCompradaOriginal: 500,
  estoqueDisponivel: 100,
  vendasAcumuladas: 400,
  velocidadeVendaDiaria: 5,
  diasDesdeLancamento: 20,
  diasRestantesJanela: 10,
};

describe("calcularSugestaoBestSeller", () => {
  // Cenário 11.1: Best Seller com estoque insuficiente.
  it("estoque insuficiente -> sugere comprar a diferença", () => {
    const r = calcularSugestaoBestSeller({ ...baseBestSeller, estoqueDisponivel: 10 });
    // demanda = 2 * (30+15) = 90; + seguranca 10 - estoque 10 = 90
    expect(r.quantidadeSugerida).toBe(90);
    expect(r.confiavel).toBe(true);
  });

  // Cenário 11.2: Best Seller com estoque suficiente.
  it("estoque suficiente -> sugestão zerada, nunca negativa", () => {
    const r = calcularSugestaoBestSeller({ ...baseBestSeller, estoqueDisponivel: 1000 });
    expect(r.quantidadeSugerida).toBe(0);
  });

  // Cenário 11.3: Best Seller com recebimento previsto antes da ruptura.
  it("recebimento previsto confiável e dentro do horizonte reduz a sugestão", () => {
    const semRecebimento = calcularSugestaoBestSeller({ ...baseBestSeller, estoqueDisponivel: 10 });
    const comRecebimento = calcularSugestaoBestSeller({
      ...baseBestSeller,
      estoqueDisponivel: 10,
      recebimentosPrevistos: [
        { quantidade: 40, dataPrevista: new Date(Date.now() + 5 * 86_400_000), confiavel: true, origem: "OP-123" },
      ],
    });
    expect(comRecebimento.recebimentosUtilizaveis).toBe(40);
    expect(comRecebimento.quantidadeSugerida).toBe(semRecebimento.quantidadeSugerida - 40);
  });

  // Cenário 11.9 (parte Best Seller): pedido em aberto sem data confiável de recebimento.
  it("pedido em aberto sem data confiável NÃO entra como disponível, só gera aviso", () => {
    const r = calcularSugestaoBestSeller({
      ...baseBestSeller,
      estoqueDisponivel: 10,
      recebimentosPrevistos: [{ quantidade: 999, dataPrevista: null, confiavel: false, origem: "Ordem de produção em aberto" }],
    });
    expect(r.recebimentosUtilizaveis).toBe(0);
    expect(r.avisos.some((a) => a.includes("sem data de recebimento confiável"))).toBe(true);
  });

  // Cenário 11.8: produto sem histórico suficiente.
  it("menos de 14 dias de histórico -> não confiável, sugestão zerada com aviso", () => {
    const r = calcularSugestaoBestSeller({ ...baseBestSeller, diasHistoricoDisponivel: 5, estoqueDisponivel: 0 });
    expect(r.confiavel).toBe(false);
    expect(r.quantidadeSugerida).toBe(0);
    expect(r.avisos.some((a) => a.includes("dia(s) de histórico"))).toBe(true);
  });

  it("sem venda e sem estoque -> sinaliza falta de dado, não força sugestão", () => {
    const r = calcularSugestaoBestSeller({ ...baseBestSeller, vendaMediaDiaria: 0, estoqueDisponivel: 0, diasHistoricoDisponivel: 60 });
    expect(r.confiavel).toBe(false);
    expect(r.avisos.some((a) => a.includes("Sem venda e sem estoque"))).toBe(true);
  });

  it("cobertura atual em dias é estoque utilizável / venda média diária", () => {
    const r = calcularSugestaoBestSeller({ ...baseBestSeller, estoqueDisponivel: 100, vendaMediaDiaria: 5 });
    expect(r.coberturaAtualDias).toBe(20);
  });

  it("estoque comprometido é descontado do disponível antes do cálculo", () => {
    const r = calcularSugestaoBestSeller({ ...baseBestSeller, estoqueDisponivel: 100, estoqueComprometido: 30 });
    expect(r.estoqueDisponivelUtilizavel).toBe(70);
  });
});

describe("calcularSugestaoDrop", () => {
  // Cenário 11.4: Drop sem possibilidade de reposição.
  it("possibilidadeReposicao = NAO -> bloqueia recompra mesmo com risco de ruptura", () => {
    const r = calcularSugestaoDrop({ ...baseDrop, possibilidadeReposicao: PossibilidadeReposicao.NAO, estoqueDisponivel: 0 });
    expect(r.bloqueadoRecompra).toBe(true);
    expect(r.quantidadeSugerida).toBe(0);
    expect(r.riscoRuptura).toBe(true); // continua reportando o risco, só não recomenda recompra
  });

  // Cenário 11.5: Drop com estoque excessivo.
  it("estoque muito maior que a previsão de venda até o fim da janela -> risco de sobra", () => {
    const r = calcularSugestaoDrop({ ...baseDrop, estoqueDisponivel: 1000, velocidadeVendaDiaria: 1, diasRestantesJanela: 5 });
    expect(r.riscoSobra).toBe(true);
    expect(r.excedenteEstimado).toBeGreaterThan(0);
    expect(r.riscoRuptura).toBe(false);
  });

  // Cenário 11.6: Drop com risco de ruptura durante a janela comercial.
  it("previsão de venda até o fim da janela maior que o estoque -> risco de ruptura", () => {
    const r = calcularSugestaoDrop({ ...baseDrop, estoqueDisponivel: 10, velocidadeVendaDiaria: 5, diasRestantesJanela: 10 });
    expect(r.riscoRuptura).toBe(true);
    expect(r.faltanteEstimado).toBe(40); // previsao 50 - estoque 10
    expect(r.quantidadeSugerida).toBe(40);
  });

  it("possibilidadeReposicao = A_CONFIRMAR -> não sugere quantidade, exige confirmação humana", () => {
    const r = calcularSugestaoDrop({ ...baseDrop, possibilidadeReposicao: PossibilidadeReposicao.A_CONFIRMAR, estoqueDisponivel: 0 });
    expect(r.quantidadeSugerida).toBeNull();
    expect(r.precisaConfirmacaoHumana).toBe(true);
  });

  it("sell-through é vendasAcumuladas / quantidadeCompradaOriginal", () => {
    const r = calcularSugestaoDrop({ ...baseDrop, quantidadeCompradaOriginal: 500, vendasAcumuladas: 250 });
    expect(r.sellThroughAtual).toBe(50);
  });

  it("sem histórico de venda (recém lançado) e sem orçamento/custo -> não inventa quantidade inicial", () => {
    const r = calcularSugestaoDrop({ ...baseDrop, diasDesdeLancamento: 0, vendasAcumuladas: 0, quantidadeCompradaOriginal: 0 });
    expect(r.quantidadeSugerida).toBeNull();
    expect(r.precisaConfirmacaoHumana).toBe(true);
  });

  it("sem histórico de venda mas com orçamento e custo -> sugere quantidade inicial baseada no orçamento", () => {
    const r = calcularSugestaoDrop({
      ...baseDrop,
      diasDesdeLancamento: 0,
      vendasAcumuladas: 0,
      quantidadeCompradaOriginal: 0,
      orcamentoDisponivelDrop: 10_000,
      custoUnitario: 50,
    });
    expect(r.quantidadeSugerida).toBe(200);
  });

  // Cenário 11.9 (parte Drop): pedido em aberto sem data confiável não entra na cobertura da janela.
  it("pedido em aberto sem data confiável não reduz o faltante estimado", () => {
    const r = calcularSugestaoDrop({
      ...baseDrop,
      estoqueDisponivel: 10,
      velocidadeVendaDiaria: 5,
      diasRestantesJanela: 10,
      pedidosEmAberto: [{ quantidade: 100, dataPrevista: null, confiavel: false }],
    });
    expect(r.quantidadeSugerida).toBe(40);
    expect(r.avisos.some((a) => a.includes("sem data confiável"))).toBe(true);
  });

  it("quantidade sugerida respeita o teto de orçamento do Drop", () => {
    const r = calcularSugestaoDrop({
      ...baseDrop,
      estoqueDisponivel: 10,
      velocidadeVendaDiaria: 5,
      diasRestantesJanela: 10,
      orcamentoDisponivelDrop: 500,
      custoUnitario: 50,
    });
    // faltante seria 40, mas teto de orçamento é 500/50 = 10
    expect(r.quantidadeSugerida).toBe(10);
  });
});

// Correção (docs/planejamento-inteligente-estoque.md §16.2 item 1): getRecomendacoesDrop não
// usava a mesma régua de "ciclo ativo" (dropEmCicloAtivo) que planejamento-distribuicao.ts já usa
// — um Drop DESCONTINUADO/EM_ENCERRAMENTO continuava recebendo sugestão de compra positiva desde
// que dataEncerramentoPrevista não estivesse no passado. Estes testes cobrem a função de DADO
// (getRecomendacoesDrop), não só a função pura (calcularSugestaoDrop, já coberta acima).
describe("getRecomendacoesDrop (ciclo ativo)", () => {
  const COD = "DROP-CICLO-1";

  beforeEach(() => {
    classificacaoFindMany.mockReset();
    saleGroupBy.mockReset();
    returnGroupBy.mockReset().mockResolvedValue([]); // sem devolução em nenhum cenário deste describe
    stockSnapshotGroupBy.mockReset();
    productionOrderGroupBy.mockReset();

    // Venda consistente em todos os cenários: 10 un/dia (560 un em 56 dias, histórico desde 60
    // dias atrás) — suficiente pra, combinado com estoque baixo e janela futura, gerar faltante
    // (e portanto quantidadeSugerida > 0) ANTES da regra de ciclo ativo ser aplicada.
    saleGroupBy.mockImplementation((args: { where?: { cod?: { in: string[] }; saleDate?: unknown }; _min?: unknown }) => {
      const cods: string[] = args.where?.cod?.in ?? [];
      if (args._min) {
        return Promise.resolve(cods.map((cod) => ({ cod, _min: { saleDate: new Date(Date.now() - 60 * 86_400_000) } })));
      }
      if (args.where?.saleDate) {
        return Promise.resolve(cods.map((cod) => ({ cod, _sum: { quantidade: 560 } })));
      }
      return Promise.resolve(cods.map((cod) => ({ cod, _sum: { quantidade: 0 } }))); // vendasAcumuladas
    });
    stockSnapshotGroupBy.mockImplementation((args: { where?: { cod?: { in: string[] } }; _avg?: unknown }) => {
      const cods: string[] = args.where?.cod?.in ?? [];
      if (args._avg) return Promise.resolve([]); // sem custo unitário cadastrado (irrelevante pro teste)
      return Promise.resolve(cods.map((cod) => ({ cod, _sum: { quantidadeDisponivel: 5 } }))); // estoque baixo
    });
    productionOrderGroupBy.mockResolvedValue([]); // sem pedido em aberto, sem quantidade original produzida
  });

  function mockClassificado(over: { statusComercial: StatusComercialProduto; dataEncerramentoPrevista: Date | null }) {
    classificacaoFindMany.mockResolvedValue([
      {
        cod: COD,
        produto: "Jaqueta Drop Inverno",
        colecao: "Inverno26",
        grupo: "Jaquetas",
        possibilidadeReposicao: PossibilidadeReposicao.SIM,
        dataLancamento: new Date(Date.now() - 60 * 86_400_000),
        orcamentoDrop: null,
        ...over,
      },
    ]);
  }

  it("DESCONTINUADO com dataEncerramentoPrevista no futuro -> sem sugestão de compra (antes do fix seria positiva)", async () => {
    mockClassificado({
      statusComercial: StatusComercialProduto.DESCONTINUADO,
      dataEncerramentoPrevista: new Date(Date.now() + 30 * 86_400_000),
    });
    const { getRecomendacoesDrop } = await import("../compras-inteligencia");
    const [r] = await getRecomendacoesDrop({});
    expect(r.quantidadeSugerida).toBeNull();
    expect(r.valorEstimado).toBeNull();
    expect(r.avisos.some((a) => a.includes("fora de ciclo ativo"))).toBe(true);
  });

  it("EM_ENCERRAMENTO com dataEncerramentoPrevista no futuro -> sem sugestão de compra", async () => {
    mockClassificado({
      statusComercial: StatusComercialProduto.EM_ENCERRAMENTO,
      dataEncerramentoPrevista: new Date(Date.now() + 30 * 86_400_000),
    });
    const { getRecomendacoesDrop } = await import("../compras-inteligencia");
    const [r] = await getRecomendacoesDrop({});
    expect(r.quantidadeSugerida).toBeNull();
    expect(r.avisos.some((a) => a.includes("fora de ciclo ativo"))).toBe(true);
  });

  it("ATIVO com dataEncerramentoPrevista no passado -> continua sem sugestão (não regressão)", async () => {
    mockClassificado({
      statusComercial: StatusComercialProduto.ATIVO,
      dataEncerramentoPrevista: new Date(Date.now() - 5 * 86_400_000),
    });
    const { getRecomendacoesDrop } = await import("../compras-inteligencia");
    const [r] = await getRecomendacoesDrop({});
    expect(r.quantidadeSugerida).toBeFalsy(); // null ou 0 — nunca positivo
  });

  it("ATIVO dentro do ciclo (dataEncerramentoPrevista no futuro) -> continua com sugestão normal (não regressão)", async () => {
    mockClassificado({
      statusComercial: StatusComercialProduto.ATIVO,
      dataEncerramentoPrevista: new Date(Date.now() + 30 * 86_400_000),
    });
    const { getRecomendacoesDrop } = await import("../compras-inteligencia");
    const [r] = await getRecomendacoesDrop({});
    expect(r.quantidadeSugerida).toBeGreaterThan(0);
    expect(r.avisos.some((a) => a.includes("fora de ciclo ativo"))).toBe(false);
  });
});

describe("priorizarOrcamentoCompras", () => {
  const item = (over: Partial<ItemPriorizavel>): ItemPriorizavel => ({
    id: "x",
    tipoCompra: TipoCompraProduto.BEST_SELLER,
    grupo: "Camisetas",
    quantidadeSugerida: 10,
    valorEstimado: 1000,
    riscoRuptura: false,
    demandaComprovada: true,
    impactoComercial: 100,
    ...over,
  });

  // Cenário 11.10: orçamento insuficiente para todas as compras sugeridas.
  it("orçamento insuficiente -> prioriza risco de ruptura em vez de cortar tudo proporcionalmente", () => {
    const itens = [
      item({ id: "sem-risco", riscoRuptura: false, valorEstimado: 1000 }),
      item({ id: "com-risco", riscoRuptura: true, valorEstimado: 1000 }),
    ];
    const resultado = priorizarOrcamentoCompras(itens, 1000);
    const comRisco = resultado.find((r) => r.id === "com-risco")!;
    const semRisco = resultado.find((r) => r.id === "sem-risco")!;
    expect(comRisco.prioridade).toBe(1);
    expect(comRisco.atendido).toBe(true);
    expect(semRisco.atendido).toBe(false);
    expect(semRisco.motivoNaoAtendido).not.toBeNull();
  });

  it("cada item expõe os fatores usados na priorização (sem score oculto)", () => {
    const [r] = priorizarOrcamentoCompras([item({ riscoRuptura: true })], 1000);
    expect(r.fatoresPrioridade.length).toBeGreaterThan(0);
    expect(r.fatoresPrioridade.some((f) => f.includes("Risco de ruptura"))).toBe(true);
  });

  it("sem orçamento definido (null) -> todos atendidos, só ordena", () => {
    const resultado = priorizarOrcamentoCompras([item({ valorEstimado: 999_999 })], null);
    expect(resultado[0].atendido).toBe(true);
  });

  it("Drop prioriza risco de ruptura dentro da janela antes de urgência por dias restantes", () => {
    const itens = [
      item({ id: "drop-urgente", tipoCompra: TipoCompraProduto.DROP, riscoRuptura: false, diasRestantesJanela: 2, valorEstimado: 100 }),
      item({ id: "drop-risco", tipoCompra: TipoCompraProduto.DROP, riscoRuptura: true, diasRestantesJanela: 20, valorEstimado: 100 }),
    ];
    const resultado = priorizarOrcamentoCompras(itens, 1000);
    expect(resultado[0].id).toBe("drop-risco");
  });
});

describe("resolverTipoCompraProduto", () => {
  it("lança erro se chamado sem nenhuma classificação (uso indevido, nunca deveria acontecer em produção)", () => {
    expect(() => resolverTipoCompraProduto([])).toThrow();
  });

  it("unânime (todos os cods do produto com o mesmo tipo) -> usa esse tipo, sem divergência", () => {
    const r = resolverTipoCompraProduto([
      { tipoCompra: TipoCompraProduto.BEST_SELLER, receita: 100 },
      { tipoCompra: TipoCompraProduto.BEST_SELLER, receita: 50 },
    ]);
    expect(r).toEqual({ tipoCompra: TipoCompraProduto.BEST_SELLER, divergente: false });
  });

  it("divergente -> vence o tipo com mais receita somada", () => {
    const r = resolverTipoCompraProduto([
      { tipoCompra: TipoCompraProduto.BEST_SELLER, receita: 1000 },
      { tipoCompra: TipoCompraProduto.DROP, receita: 10 },
    ]);
    expect(r).toEqual({ tipoCompra: TipoCompraProduto.BEST_SELLER, divergente: true });
  });

  it("divergente com Drop vencendo por receita -> retorna DROP", () => {
    const r = resolverTipoCompraProduto([
      { tipoCompra: TipoCompraProduto.BEST_SELLER, receita: 10 },
      { tipoCompra: TipoCompraProduto.DROP, receita: 1000 },
    ]);
    expect(r).toEqual({ tipoCompra: TipoCompraProduto.DROP, divergente: true });
  });

  it("empate exato de receita (inclusive 0 contra 0) -> cai pra BEST_SELLER, lado conservador", () => {
    const empateZero = resolverTipoCompraProduto([
      { tipoCompra: TipoCompraProduto.BEST_SELLER, receita: 0 },
      { tipoCompra: TipoCompraProduto.DROP, receita: 0 },
    ]);
    expect(empateZero).toEqual({ tipoCompra: TipoCompraProduto.BEST_SELLER, divergente: true });

    const empateNaoZero = resolverTipoCompraProduto([
      { tipoCompra: TipoCompraProduto.BEST_SELLER, receita: 500 },
      { tipoCompra: TipoCompraProduto.DROP, receita: 500 },
    ]);
    expect(empateNaoZero).toEqual({ tipoCompra: TipoCompraProduto.BEST_SELLER, divergente: true });
  });

  it("múltiplos cods do mesmo lado somam a receita antes de comparar (3 BS pequenos vencem 1 Drop grande)", () => {
    const r = resolverTipoCompraProduto([
      { tipoCompra: TipoCompraProduto.BEST_SELLER, receita: 400 },
      { tipoCompra: TipoCompraProduto.BEST_SELLER, receita: 400 },
      { tipoCompra: TipoCompraProduto.BEST_SELLER, receita: 400 },
      { tipoCompra: TipoCompraProduto.DROP, receita: 1000 },
    ]);
    expect(r).toEqual({ tipoCompra: TipoCompraProduto.BEST_SELLER, divergente: true });
  });
});

// Achado 1 da auditoria pós-incidente de 2026-11-25: fonte única de identidade "Best Seller" —
// classificação manual (ClassificacaoProduto.tipoCompra) sobrescreve quando existe; na ausência,
// colecao === "BESTSELLER" já basta. Testada aqui porque é a função central reaproveitada por
// distribuicao-estoque.ts/planejamento-estoque.ts/planejamento-distribuicao.ts/matriz-helpers.ts.
describe("resolverTipoCompraEfetivo (fonte única de identidade Best Seller)", () => {
  it("sem classificação manual e colecao BESTSELLER -> BEST_SELLER", () => {
    expect(resolverTipoCompraEfetivo(null, "BESTSELLER")).toBe(TipoCompraProduto.BEST_SELLER);
  });

  it("sem classificação manual e colecao de Drop sazonal -> null (nunca inferido)", () => {
    expect(resolverTipoCompraEfetivo(null, "V26.1")).toBeNull();
  });

  it("sem classificação manual e sem colecao -> null", () => {
    expect(resolverTipoCompraEfetivo(undefined, null)).toBeNull();
  });

  it("classificação manual DROP sobrescreve colecao BESTSELLER (decisão humana mais recente vence)", () => {
    expect(resolverTipoCompraEfetivo(TipoCompraProduto.DROP, "BESTSELLER")).toBe(TipoCompraProduto.DROP);
  });

  it("classificação manual BEST_SELLER vale mesmo com colecao de Drop sazonal", () => {
    expect(resolverTipoCompraEfetivo(TipoCompraProduto.BEST_SELLER, "V26.1")).toBe(TipoCompraProduto.BEST_SELLER);
  });
});

// Achado 2 da auditoria pós-incidente de 2026-11-25: classificarProdutoEmLoteAction grava o MESMO
// dataLancamento do form pra todos os cods do lote — quando o campo vem vazio (reclassificação,
// não exige a data), upsertClassificacaoProduto não pode apagar um dataLancamento REAL já
// cadastrado substituindo por null.
describe("upsertClassificacaoProduto — nunca apaga dataLancamento real com null do form vazio", () => {
  const baseInput: ClassificacaoInput = {
    cod: "COD-1",
    produto: "Camisa Polo",
    grupo: "Polos",
    colecao: null,
    tipoCompra: TipoCompraProduto.BEST_SELLER,
    statusComercial: StatusComercialProduto.ATIVO,
    possibilidadeReposicao: PossibilidadeReposicao.SIM,
    orcamentoDrop: null,
    observacoes: null,
  };

  beforeEach(() => {
    classificacaoFindUnique.mockReset();
    classificacaoUpsert.mockReset().mockResolvedValue({ id: "cls-1" });
    classificacaoHistoricoCreateMany.mockReset();
  });

  it("reclassificação (produto já existia) com dataLancamento vazio no form PRESERVA a data real já cadastrada", async () => {
    const dataReal = new Date("2026-01-10T00:00:00.000Z");
    classificacaoFindUnique.mockResolvedValue({
      cod: "COD-1", produto: "Camisa Polo", grupo: "Polos", colecao: null,
      tipoCompra: TipoCompraProduto.DROP, statusComercial: StatusComercialProduto.ATIVO,
      possibilidadeReposicao: PossibilidadeReposicao.SIM,
      dataLancamento: dataReal, dataEncerramentoPrevista: null, orcamentoDrop: null, observacoes: null,
    });

    // Mesmo cenário do form de reclassificação em lote: dataLancamento não informada (null) porque
    // o cod já tinha classificação (classificarProdutoEmLoteAction só exige a data pra cod novo).
    await upsertClassificacaoProduto({ ...baseInput, dataLancamento: null }, "gestao@tvb.com");

    expect(classificacaoUpsert).toHaveBeenCalledTimes(1);
    const { update } = classificacaoUpsert.mock.calls[0][0] as { update: { dataLancamento: Date | null } };
    expect(update.dataLancamento).toEqual(dataReal);
  });

  it("quando o form informa uma data real, ela sobrescreve a anterior normalmente (nunca trava uma correção legítima)", async () => {
    const dataAntiga = new Date("2026-01-10T00:00:00.000Z");
    const dataNova = new Date("2026-02-20T00:00:00.000Z");
    classificacaoFindUnique.mockResolvedValue({
      cod: "COD-1", produto: "Camisa Polo", grupo: "Polos", colecao: null,
      tipoCompra: TipoCompraProduto.DROP, statusComercial: StatusComercialProduto.ATIVO,
      possibilidadeReposicao: PossibilidadeReposicao.SIM,
      dataLancamento: dataAntiga, dataEncerramentoPrevista: null, orcamentoDrop: null, observacoes: null,
    });

    await upsertClassificacaoProduto({ ...baseInput, dataLancamento: dataNova }, "gestao@tvb.com");

    const { update } = classificacaoUpsert.mock.calls[0][0] as { update: { dataLancamento: Date | null } };
    expect(update.dataLancamento).toEqual(dataNova);
  });

  it("produto novo (sem linha existente) sem dataLancamento continua rejeitado (regra de obrigatoriedade pra classificação nova, inalterada)", async () => {
    classificacaoFindUnique.mockResolvedValue(null);

    await expect(upsertClassificacaoProduto({ ...baseInput, dataLancamento: null }, "gestao@tvb.com")).rejects.toThrow(
      "Data de lançamento é obrigatória"
    );
    expect(classificacaoUpsert).not.toHaveBeenCalled();
  });
});
