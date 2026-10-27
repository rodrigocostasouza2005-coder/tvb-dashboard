import { describe, it, expect } from "vitest";
import { PossibilidadeReposicao, TipoCompraProduto } from "@prisma/client";
import {
  calcularSugestaoBestSeller,
  calcularSugestaoDrop,
  priorizarOrcamentoCompras,
  type InputBestSeller,
  type InputDrop,
  type ItemPriorizavel,
} from "../compras-inteligencia";

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
