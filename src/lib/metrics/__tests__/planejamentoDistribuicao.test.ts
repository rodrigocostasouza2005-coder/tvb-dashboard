import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VariantePorLoja, MovimentacaoRecomendada } from "../distribuicao-estoque";

const getComparacaoCompleta = vi.fn();
const getMovimentacoesRecomendadas = vi.fn();
const getHistoricoMovimentacoes = vi.fn();
const getPedidosEmAbertoPorCod = vi.fn((..._a: unknown[]) => {
  throw new Error("getPedidosEmAbertoPorCod NUNCA deveria ser chamado por planejamento-distribuicao.ts");
});
const classificacaoProdutoFindMany = vi.fn();
const getParametrosBestSellerPorGrupo = vi.fn();

// construirOrigem/diagnosticarVariante/etc. ficam REAIS (importActual) — são funções puras, a
// mesma régua de mínimo+margem que o motor usa pra decidir quem pode doar. Só as funções de DADO
// (Prisma por trás) são mockadas, mesmo padrão de planejamentoEstoque.test.ts.
vi.mock("../distribuicao-estoque", async (importActual) => {
  const actual = await importActual<typeof import("../distribuicao-estoque")>();
  return {
    ...actual,
    getComparacaoCompleta: (...a: unknown[]) => getComparacaoCompleta(...a),
    getMovimentacoesRecomendadas: (...a: unknown[]) => getMovimentacoesRecomendadas(...a),
    getHistoricoMovimentacoes: (...a: unknown[]) => getHistoricoMovimentacoes(...a),
  };
});

// Mockado só pra GARANTIR (teste "disponível vs. trânsito" abaixo) que esta camada nunca toca
// ProductionOrder/trânsito — se algum código novo passar a chamar isso, o teste quebra alto.
vi.mock("../compras-inteligencia", () => ({
  getPedidosEmAbertoPorCod: (...a: unknown[]) => getPedidosEmAbertoPorCod(...a),
  getParametrosBestSellerPorGrupo: (...a: unknown[]) => getParametrosBestSellerPorGrupo(...a),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { classificacaoProduto: { findMany: (...a: unknown[]) => classificacaoProdutoFindMany(...a) } },
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

function movimentacao(overrides: Partial<MovimentacaoRecomendada> = {}): MovimentacaoRecomendada {
  return {
    cod: "COD-1",
    produto: "Camisa Polo",
    grupo: "Polos",
    cor: "Azul",
    tamanho: "M",
    tipoMovimentacao: "loja_loja",
    classificacao: "REDISTRIBUIR",
    prioridade: "media",
    confianca: "alta",
    origemPosicaoId: "loja-a",
    origemNome: "Loja A",
    destinoPosicaoId: "loja-b",
    destinoNome: "Loja B",
    quantidadeSugerida: 5,
    estoqueOrigemAntes: 20,
    estoqueOrigemDepois: 15,
    estoqueDestinoAntes: 0,
    estoqueDestinoDepois: 5,
    disponivelOrigem: 5,
    coberturaOrigemAntes: 90,
    coberturaOrigemDepois: 60,
    coberturaDestinoAntes: null,
    coberturaDestinoDepois: 20,
    vendasOrigem30: 1,
    vendasOrigem90: 3,
    vendasDestino30: 2,
    vendasDestino90: 6,
    giroOrigemDia: 0.1,
    giroDestinoDia: 0.2,
    justificativa: ["justificativa de teste"],
    impactoEsperado: "impacto de teste",
    avisos: [],
    ...overrides,
  };
}

beforeEach(() => {
  getComparacaoCompleta.mockReset();
  getMovimentacoesRecomendadas.mockReset().mockResolvedValue({ movimentacoes: [], manter: [], necessidadesNaoAtendidas: [], colunas: [], totalAntesDoFiltro: 0 });
  getHistoricoMovimentacoes.mockReset();
  getPedidosEmAbertoPorCod.mockClear();
  classificacaoProdutoFindMany.mockReset().mockResolvedValue([]);
  getParametrosBestSellerPorGrupo.mockReset().mockResolvedValue([]);
});

describe("getExcessosEDistribuicao", () => {
  it("agrega excesso de CD/loja e permanência reaproveitando construirOrigem (sem fórmula nova)", async () => {
    // CD: estoque 200, mínimo 50, velocidade 1/dia -> margem = round(1*7*0.5) = 4 -> disponível =
    // 200-50-4 = 146. Loja: estoque 30, mínimo 10, velocidade 0.2/dia -> margem = round(0.7) = 1 ->
    // disponível = 30-10-1 = 19.
    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        variante({
          porLoja: [
            cd({ estoqueAtual: 200, estoqueMinimo: 50, velocidadeDiaria: 1, vendasDias90: 90, diagnostico: "cobertura_excessiva" }),
            loja({ estoqueAtual: 30, estoqueMinimo: 10, velocidadeDiaria: 0.2, vendasDias90: 18, diagnostico: "cobertura_excessiva" }),
          ],
        }),
      ],
    });

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const [r] = await getExcessosEDistribuicao();

    expect(r.produto).toBe("Camisa Polo");
    expect(r.excessoCD).toBe(146);
    expect(r.estoqueCDPermanece).toBe(200 - 146); // 54 = mínimo (50) + margem (4)
    expect(r.excessoLojas).toBe(19);
  });

  it("sinaliza rupturaComExcessoDisponivel quando uma loja está em ruptura e outra posição do mesmo produto tem excesso", async () => {
    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        variante({
          porLoja: [
            loja({ storeId: "loja-a", estoqueAtual: 0, vendasDias90: 10, diagnostico: "ruptura" }),
            loja({ storeId: "loja-b", estoqueAtual: 500, estoqueMinimo: 0, velocidadeDiaria: 0, vendasDias90: 0, diagnostico: "estoque_parado" }),
          ],
        }),
      ],
    });

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const [r] = await getExcessosEDistribuicao();

    expect(r.rupturaLojas).toBe(1);
    expect(r.excessoLojas).toBeGreaterThan(0);
    expect(r.rupturaComExcessoDisponivel).toBe(true);
  });

  it("produto sem nenhum sinal (tudo equilibrado) não aparece na lista", async () => {
    getComparacaoCompleta.mockResolvedValue({
      variantes: [variante({ porLoja: [loja({ estoqueAtual: 20, estoqueMinimo: 10, vendasDias90: 18, velocidadeDiaria: 0.2, diagnostico: "equilibrado" })] })],
    });

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const resultado = await getExcessosEDistribuicao();

    expect(resultado).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // Teste obrigatório: reconciliação de quantidades
  // ---------------------------------------------------------------------
  it("reconciliação: as oportunidades expostas preservam exatamente a quantidade/origem/destino calculadas pelo motor (nada é somado, duplicado ou alterado em trânsito por esta camada)", async () => {
    getComparacaoCompleta.mockResolvedValue({ variantes: [variante()] });
    const m1 = movimentacao({ cod: "COD-1", origemNome: "CD/Site", destinoNome: "Loja A", quantidadeSugerida: 7 });
    const m2 = movimentacao({ cod: "COD-1", origemNome: "Loja B", destinoNome: "Loja C", quantidadeSugerida: 3 });
    getMovimentacoesRecomendadas.mockResolvedValue({ movimentacoes: [m1, m2], manter: [], necessidadesNaoAtendidas: [], colunas: [], totalAntesDoFiltro: 2 });

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const [r] = await getExcessosEDistribuicao();

    const totalSaindoDasOrigens = r.oportunidades.reduce((s, o) => s + o.quantidadeSugerida, 0);
    const totalEntrandoNosDestinos = r.oportunidades.reduce((s, o) => s + (o.estoqueDestinoDepois - o.estoqueDestinoAntes), 0);
    expect(r.oportunidades).toHaveLength(2);
    expect(totalSaindoDasOrigens).toBe(10); // 7 + 3, sem perder nem duplicar nenhuma
    expect(totalEntrandoNosDestinos).toBe(10); // mesma soma: o que sai de uma origem é exatamente o que entra no destino, por item
    expect(r.oportunidades).toEqual(expect.arrayContaining([m1, m2])); // objetos passados sem mutação
  });

  // ---------------------------------------------------------------------
  // Teste obrigatório: dupla contagem de demanda (CD/Site já embute demanda das lojas)
  // ---------------------------------------------------------------------
  it("NUNCA soma demanda/venda entre posições — excessoCD depende só da margem/mínimo DA PRÓPRIA posição CD, nunca da venda da loja", async () => {
    const cdFixo = cd({ estoqueAtual: 200, estoqueMinimo: 50, velocidadeDiaria: 1, vendasDias90: 90, diagnostico: "cobertura_excessiva" });

    getComparacaoCompleta.mockResolvedValue({
      variantes: [variante({ porLoja: [cdFixo, loja({ estoqueAtual: 30, estoqueMinimo: 10, velocidadeDiaria: 0.2, vendasDias90: 18, diagnostico: "cobertura_excessiva" })] })],
    });
    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const [semDobrar] = await getExcessosEDistribuicao();

    // Agora dobra a venda da LOJA (vendasDias30/60/90) sem mudar nada do CD — se este módulo
    // somasse demanda entre posições, excessoCD mudaria. Ele NUNCA deveria mudar, porque
    // construirOrigem(cd) só lê os campos da própria linha do CD.
    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        variante({
          porLoja: [
            cdFixo,
            loja({ estoqueAtual: 30, estoqueMinimo: 10, velocidadeDiaria: 0.4, vendasDias30: 24, vendasDias60: 48, vendasDias90: 36, diagnostico: "cobertura_excessiva" }),
          ],
        }),
      ],
    });
    const { getExcessosEDistribuicao: getExcessosEDistribuicao2 } = await import("../planejamento-distribuicao");
    const [comVendaDobradaNaLoja] = await getExcessosEDistribuicao2();

    expect(comVendaDobradaNaLoja.excessoCD).toBe(semDobrar.excessoCD);
    expect(comVendaDobradaNaLoja.estoqueCDPermanece).toBe(semDobrar.estoqueCDPermanece);
  });

  // ---------------------------------------------------------------------
  // Teste obrigatório: nunca sugere/expõe excesso que geraria ruptura na origem
  // ---------------------------------------------------------------------
  it("nunca trata como 'disponível pra transferir' uma quantidade que deixaria a origem abaixo do próprio mínimo + margem de segurança", async () => {
    // estoqueAtual=95, estoqueMinimo=90, velocidadeDiaria=2 -> margem = round(2*7*0.5)=7.
    // Uma conta INGÊNUA (estoqueAtual - estoqueMinimo, sem margem) diria que há 5 un. disponíveis
    // (95-90) — construirOrigem (reaproveitado, não reimplementado) reserva TAMBÉM a margem
    // (90+7=97 > 95) e zera isso: nada é oferecido, porque oferecer qualquer coisa colocaria a
    // origem abaixo do que ela mesma precisa guardar.
    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        variante({
          porLoja: [loja({ estoqueAtual: 95, estoqueMinimo: 90, velocidadeDiaria: 2, vendasDias90: 180, diagnostico: "cobertura_excessiva" })],
        }),
      ],
    });

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const resultado = await getExcessosEDistribuicao();

    // Sem nenhum sinal de excesso real (disponível=0) e sem ruptura/oportunidade, o produto não
    // deveria nem aparecer na lista — a prova mais forte de que "5 un." (a conta ingênua) nunca é
    // oferecido como disponível.
    expect(resultado).toHaveLength(0);
  });

  it("quando o estoque passa do mínimo+margem, só a sobra REAL (não a conta ingênua) conta como excesso", async () => {
    // estoqueAtual=120, estoqueMinimo=90, velocidadeDiaria=2 -> margem=7 -> disponível real = 23
    // (não 30, que seria a conta ingênua sem margem).
    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        variante({
          porLoja: [loja({ estoqueAtual: 120, estoqueMinimo: 90, velocidadeDiaria: 2, vendasDias90: 180, diagnostico: "cobertura_excessiva" })],
        }),
      ],
    });

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const [r] = await getExcessosEDistribuicao();

    expect(r.excessoLojas).toBe(23);
    expect(r.excessoLojas).not.toBe(30);
  });

  // ---------------------------------------------------------------------
  // Teste obrigatório: disponível vs. trânsito/produção
  // ---------------------------------------------------------------------
  it("nunca consulta ProductionOrder/trânsito (getPedidosEmAbertoPorCod) — disponível vem só de estoque atual, nunca de produção não confiável", async () => {
    getComparacaoCompleta.mockResolvedValue({
      variantes: [variante({ porLoja: [loja({ estoqueAtual: 100, estoqueMinimo: 0, velocidadeDiaria: 0, vendasDias90: 0, diagnostico: "estoque_parado" })] })],
    });

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    await getExcessosEDistribuicao();

    expect(getPedidosEmAbertoPorCod).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Regra de negócio nova desta fase: Drop em ciclo ativo protegido de "excesso"
  // ---------------------------------------------------------------------
  it("suprime oportunidade de transferência cuja origem é um Drop ainda em ciclo ativo (dataEncerramentoPrevista no futuro) e teve venda real nos 90d", async () => {
    getComparacaoCompleta.mockResolvedValue({ variantes: [variante({ tipoCompra: "DROP" })] });
    const futura = new Date(Date.now() + 10 * 86_400_000);
    classificacaoProdutoFindMany.mockResolvedValue([{ cod: "COD-1", statusComercial: "ATIVO", dataEncerramentoPrevista: futura }]);
    getMovimentacoesRecomendadas.mockResolvedValue({
      movimentacoes: [movimentacao({ cod: "COD-1", vendasOrigem90: 5 })],
      manter: [],
      necessidadesNaoAtendidas: [],
      colunas: [],
      totalAntesDoFiltro: 1,
    });

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const [r] = await getExcessosEDistribuicao();

    expect(r.oportunidades).toHaveLength(0);
    expect(r.dropsCicloAtivoProtegidos).toBe(1);
  });

  it("NÃO suprime oportunidade de Drop já encerrado (dataEncerramentoPrevista no passado) — ciclo acabou, excesso é real", async () => {
    getComparacaoCompleta.mockResolvedValue({ variantes: [variante({ tipoCompra: "DROP" })] });
    const passada = new Date(Date.now() - 10 * 86_400_000);
    classificacaoProdutoFindMany.mockResolvedValue([{ cod: "COD-1", statusComercial: "ATIVO", dataEncerramentoPrevista: passada }]);
    getMovimentacoesRecomendadas.mockResolvedValue({
      movimentacoes: [movimentacao({ cod: "COD-1", vendasOrigem90: 5 })],
      manter: [],
      necessidadesNaoAtendidas: [],
      colunas: [],
      totalAntesDoFiltro: 1,
    });

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const [r] = await getExcessosEDistribuicao();

    expect(r.oportunidades).toHaveLength(1);
    expect(r.dropsCicloAtivoProtegidos).toBe(0);
  });

  it("NÃO suprime oportunidade de Drop ativo com estoque_parado (vendasOrigem90 = 0, verdadeiramente morto)", async () => {
    getComparacaoCompleta.mockResolvedValue({ variantes: [variante({ tipoCompra: "DROP" })] });
    classificacaoProdutoFindMany.mockResolvedValue([{ cod: "COD-1", statusComercial: "ATIVO", dataEncerramentoPrevista: null }]);
    getMovimentacoesRecomendadas.mockResolvedValue({
      movimentacoes: [movimentacao({ cod: "COD-1", vendasOrigem90: 0 })],
      manter: [],
      necessidadesNaoAtendidas: [],
      colunas: [],
      totalAntesDoFiltro: 1,
    });

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const [r] = await getExcessosEDistribuicao();

    expect(r.oportunidades).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // Ajuste de regra (Rodrigo, 2026-11-17): Drop ativo também não conta no CONTADOR de excesso
  // (Passo 1), não só na lista de oportunidades (Passo 2) — consistência entre as duas visões.
  // ---------------------------------------------------------------------
  it("Drop em ciclo ativo com venda real também fica de fora de excessoCD/excessoLojas (não só das oportunidades) e entra como 'deve permanecer'", async () => {
    // Mesmo fixture do teste de agregação básica: CD 200/mínimo 50/velocidade 1 -> disponível 146.
    const cdFixo = cd({ estoqueAtual: 200, estoqueMinimo: 50, velocidadeDiaria: 1, vendasDias90: 90, diagnostico: "cobertura_excessiva" });
    getComparacaoCompleta.mockResolvedValue({ variantes: [variante({ tipoCompra: "DROP", porLoja: [cdFixo] })] });
    const futura = new Date(Date.now() + 10 * 86_400_000);
    classificacaoProdutoFindMany.mockResolvedValue([{ cod: "COD-1", statusComercial: "ATIVO", dataEncerramentoPrevista: futura }]);

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const [r] = await getExcessosEDistribuicao();

    expect(r.excessoCD).toBe(0);
    expect(r.excessoDropProtegido).toBe(146);
    expect(r.estoqueCDPermanece).toBe(200); // 54 (mínimo+margem) + 146 (retido) = tudo permanece
    expect(r.classificacao).toBe("DROP");
  });

  it("Drop já encerrado (ciclo não ativo) não tem nenhuma retenção especial — excesso conta normal", async () => {
    const cdFixo = cd({ estoqueAtual: 200, estoqueMinimo: 50, velocidadeDiaria: 1, vendasDias90: 90, diagnostico: "cobertura_excessiva" });
    getComparacaoCompleta.mockResolvedValue({ variantes: [variante({ tipoCompra: "DROP", porLoja: [cdFixo] })] });
    const passada = new Date(Date.now() - 10 * 86_400_000);
    classificacaoProdutoFindMany.mockResolvedValue([{ cod: "COD-1", statusComercial: "ATIVO", dataEncerramentoPrevista: passada }]);

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const [r] = await getExcessosEDistribuicao();

    expect(r.excessoCD).toBe(146);
    expect(r.excessoDropProtegido).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Ajuste de regra: Best Seller passa a ter reserva de continuidade (lead time real × velocidade),
  // não mais imunidade absoluta — ver aplicarRetencoes em planejamento-distribuicao.ts.
  // ---------------------------------------------------------------------
  it("Best Seller com leadTimeDias configurado no grupo: reserva parcial reduz o excesso, mas não zera (não é imunidade)", async () => {
    // loja 120/mínimo 90/velocidade 2 -> disponível real 23 (mesma conta do teste de margem acima).
    // leadTimeDias=10 -> reserva = round(2*10) = 20 -> disponivelParaExcesso = max(0, 23-20) = 3.
    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        variante({
          tipoCompra: "BEST_SELLER",
          porLoja: [loja({ estoqueAtual: 120, estoqueMinimo: 90, velocidadeDiaria: 2, vendasDias90: 180, diagnostico: "cobertura_excessiva" })],
        }),
      ],
    });
    getParametrosBestSellerPorGrupo.mockResolvedValue([{ grupo: "Polos", estoqueSegurancaUnidades: null, leadTimeDias: 10 }]);

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const [r] = await getExcessosEDistribuicao();

    expect(r.excessoLojas).toBe(3);
    expect(r.excessoLojas).toBeGreaterThan(0); // não é imunidade: excesso real acima da reserva ainda conta
    expect(r.reservaContinuidadeBestSeller).toBe(20);
    expect(r.classificacao).toBe("BEST_SELLER");
  });

  it("Best Seller sem leadTimeDias configurado no grupo: reserva é 0, comportamento idêntico ao de antes desta mudança", async () => {
    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        variante({
          tipoCompra: "BEST_SELLER",
          porLoja: [loja({ estoqueAtual: 120, estoqueMinimo: 90, velocidadeDiaria: 2, vendasDias90: 180, diagnostico: "cobertura_excessiva" })],
        }),
      ],
    });
    getParametrosBestSellerPorGrupo.mockResolvedValue([]); // grupo não cadastrado em CoberturaMeta

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const [r] = await getExcessosEDistribuicao();

    expect(r.excessoLojas).toBe(23); // mesma conta "ingênua vs. real" de antes, sem reserva nova
    expect(r.reservaContinuidadeBestSeller).toBe(0);
  });

  it("reserva de continuidade de Best Seller nunca suprime oportunidades de transferência (Passo 2 fica intocado)", async () => {
    getComparacaoCompleta.mockResolvedValue({ variantes: [variante({ tipoCompra: "BEST_SELLER" })] });
    getParametrosBestSellerPorGrupo.mockResolvedValue([{ grupo: "Polos", estoqueSegurancaUnidades: null, leadTimeDias: 30 }]);
    getMovimentacoesRecomendadas.mockResolvedValue({
      movimentacoes: [movimentacao({ cod: "COD-1", vendasOrigem90: 5 })],
      manter: [],
      necessidadesNaoAtendidas: [],
      colunas: [],
      totalAntesDoFiltro: 1,
    });

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const [r] = await getExcessosEDistribuicao();

    expect(r.oportunidades).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // Produto sem classificação (ou MISTO): nunca herda a régua de Drop nem a de Best Seller, e
  // nunca é escondido da visão de excesso/distribuição.
  // ---------------------------------------------------------------------
  it("produto NAO_CLASSIFICADO (tipoCompra null) mostra excesso real completo, sem nenhuma retenção especial", async () => {
    const cdFixo = cd({ estoqueAtual: 200, estoqueMinimo: 50, velocidadeDiaria: 1, vendasDias90: 90, diagnostico: "cobertura_excessiva" });
    getComparacaoCompleta.mockResolvedValue({ variantes: [variante({ tipoCompra: null, porLoja: [cdFixo] })] });

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const [r] = await getExcessosEDistribuicao();

    expect(r.excessoCD).toBe(146);
    expect(r.excessoDropProtegido).toBe(0);
    expect(r.reservaContinuidadeBestSeller).toBe(0);
    expect(r.classificacao).toBe("NAO_CLASSIFICADO");
  });

  it("classificacao agregada por produto: MISTO quando os cods do mesmo produto têm tipoCompra diferente", async () => {
    getComparacaoCompleta.mockResolvedValue({
      variantes: [
        variante({ cod: "COD-1", tipoCompra: "BEST_SELLER", porLoja: [loja({ estoqueAtual: 0, vendasDias90: 10, diagnostico: "ruptura" })] }),
        variante({ cod: "COD-2", tipoCompra: "DROP", porLoja: [loja({ estoqueAtual: 0, vendasDias90: 10, diagnostico: "ruptura" })] }),
      ],
    });

    const { getExcessosEDistribuicao } = await import("../planejamento-distribuicao");
    const [r] = await getExcessosEDistribuicao();

    expect(r.classificacao).toBe("MISTO");
  });
});

describe("getProdutoExcessoDistribuicao", () => {
  it("devolve o produto quando ele tem sinal", async () => {
    getComparacaoCompleta.mockResolvedValue({
      variantes: [variante({ produto: "Boné Dry", porLoja: [loja({ estoqueAtual: 0, vendasDias90: 10, diagnostico: "ruptura" })] })],
    });

    const { getProdutoExcessoDistribuicao } = await import("../planejamento-distribuicao");
    const r = await getProdutoExcessoDistribuicao("Boné Dry");

    expect(r).not.toBeNull();
    expect(r!.produto).toBe("Boné Dry");
  });

  it("devolve null quando o produto não tem nenhum sinal (ou não existe)", async () => {
    getComparacaoCompleta.mockResolvedValue({ variantes: [] });

    const { getProdutoExcessoDistribuicao } = await import("../planejamento-distribuicao");
    const r = await getProdutoExcessoDistribuicao("Produto Inexistente");

    expect(r).toBeNull();
  });
});

describe("getDecisoesMovimentacaoPorStatus", () => {
  function historico(itens: HistoricoMovimentacoesItem[] = []) {
    return { migrationPendente: false, itens };
  }
  type HistoricoMovimentacoesItem = {
    id: string;
    cod: string;
    produto: string;
    grupo: string;
    cor: string | null;
    tamanho: string | null;
    origemNome: string;
    destinoNome: string;
    tipoMovimentacao: string;
    classificacao: string;
    quantidadeSugerida: number;
    quantidadeAprovada: number | null;
    quantidadeExecutada: number | null;
    status: string;
    confianca: string;
    recomendadoEm: Date;
    decididoEm: Date | null;
    decididoPor: string | null;
    executadoEm: Date | null;
    executadoPor: string | null;
    observacao: string | null;
  };
  function item(overrides: Partial<HistoricoMovimentacoesItem> = {}): HistoricoMovimentacoesItem {
    return {
      id: "id-1",
      cod: "COD-1",
      produto: "Camisa Polo",
      grupo: "Polos",
      cor: null,
      tamanho: null,
      origemNome: "CD/Site",
      destinoNome: "Loja A",
      tipoMovimentacao: "CD_SITE_LOJA",
      classificacao: "REDISTRIBUIR",
      quantidadeSugerida: 5,
      quantidadeAprovada: null,
      quantidadeExecutada: null,
      status: "PENDENTE",
      confianca: "alta",
      recomendadoEm: new Date(),
      decididoEm: null,
      decididoPor: null,
      executadoEm: null,
      executadoPor: null,
      observacao: null,
      ...overrides,
    };
  }

  it("busca as 4 categorias de status em paralelo e devolve cada uma no campo certo", async () => {
    getHistoricoMovimentacoes.mockImplementation(({ status }: { status: string }) =>
      Promise.resolve(historico([item({ status, id: `id-${status}` })]))
    );

    const { getDecisoesMovimentacaoPorStatus } = await import("../planejamento-distribuicao");
    const r = await getDecisoesMovimentacaoPorStatus();

    expect(r.pendente).toHaveLength(1);
    expect(r.pendente[0].status).toBe("PENDENTE");
    expect(r.aprovada[0].status).toBe("APROVADA");
    expect(r.executada[0].status).toBe("EXECUTADA");
    expect(r.recusada[0].status).toBe("RECUSADA");
  });

  it("propaga migrationPendente sem esconder (mesma régua de getHistoricoMovimentacoes)", async () => {
    getHistoricoMovimentacoes.mockResolvedValue({ migrationPendente: true, itens: [] });

    const { getDecisoesMovimentacaoPorStatus } = await import("../planejamento-distribuicao");
    const r = await getDecisoesMovimentacaoPorStatus();

    expect(r.migrationPendente).toBe(true);
  });

  it("filtra por produto em memória (pós-leitura), sem precisar de um filtro novo em getHistoricoMovimentacoes", async () => {
    getHistoricoMovimentacoes.mockImplementation(({ status }: { status: string }) =>
      Promise.resolve(
        historico([item({ status, produto: "Camisa Polo", id: `a-${status}` }), item({ status, produto: "Outro Produto", id: `b-${status}` })])
      )
    );

    const { getDecisoesMovimentacaoPorStatus } = await import("../planejamento-distribuicao");
    const r = await getDecisoesMovimentacaoPorStatus({ produto: "Camisa Polo" });

    expect(r.pendente).toHaveLength(1);
    expect(r.pendente[0].produto).toBe("Camisa Polo");
  });
});
