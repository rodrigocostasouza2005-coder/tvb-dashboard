import { describe, it, expect, vi, beforeEach } from "vitest";

const storeFindFirst = vi.fn();
const saleAggregate = vi.fn();
const saleGroupBy = vi.fn();
const returnAggregate = vi.fn();
const getInsightsPorConjunto = vi.fn();
const metaDiariaBlackFridayFindMany = vi.fn();
const getSalesByDay = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findFirst: (...a: unknown[]) => storeFindFirst(...a) },
    sale: {
      aggregate: (...a: unknown[]) => saleAggregate(...a),
      groupBy: (...a: unknown[]) => saleGroupBy(...a),
    },
    return: { aggregate: (...a: unknown[]) => returnAggregate(...a) },
    metaDiariaBlackFriday: { findMany: (...a: unknown[]) => metaDiariaBlackFridayFindMany(...a) },
  },
}));

vi.mock("@/lib/connectors/meta-ads", () => ({
  getInsightsPorConjunto: (...a: unknown[]) => getInsightsPorConjunto(...a),
}));

// "./vendas" só é mockado aqui pra testar getComparativoMetaDiariaBlackFriday (abaixo) sem bater
// no banco de verdade — nenhum outro teste deste arquivo chama a versão async de
// getTopProdutosBlackFriday/getVendasPorFaixaDesconto (só as versões PURAS montarX), então mockar
// o módulo inteiro aqui não afeta os demais.
vi.mock("../vendas", () => ({
  getSalesByGrupoProduto: vi.fn(),
  getReturnsByGrupoProduto: vi.fn(),
  getSalesByDay: (...a: unknown[]) => getSalesByDay(...a),
}));

import {
  montarVendasPorCanal,
  montarProdutosBlackFriday,
  montarVendasPorFaixaDesconto,
  montarComparativoMetaDiariaBlackFriday,
  encontrarDiaPorData,
  getComparativoMetaDiariaBlackFriday,
  montarVendasPorEstadoEcommerce,
  montarTop20ProdutosComDesconto,
  periodoAnterior,
  ORDEM_CANAL,
  excluirAtacado,
  getResumoBlackFriday,
} from "../black-friday";
import type { DashboardFilters } from "../core";

// Regressão real (missão de refinamento, 2026-11-05): getVendasPorCanal usava
// `where: { sellsProducts: true }` — "Uniformes"/"Produtos acabados"/"Matérias-primas" são
// estágios de manufatura com sellsProducts=true de propósito (estoque sellável real, usado em
// estoque.ts/vendas.ts) e apareciam como "canal" por engano. A allowlist explícita (ORDEM_CANAL,
// também usada como filtro da query, não só ordem) é a proteção real — este teste trava que
// ninguém re-adicione um nome de estágio de manufatura aqui por acidente.
describe("ORDEM_CANAL — allowlist de canais comerciais reais", () => {
  it("nunca inclui estágio de manufatura/estoque (Uniformes, Produtos acabados, Matérias-primas)", () => {
    for (const nome of ["Uniformes", "Produtos acabados", "Matérias-primas"]) {
      expect(ORDEM_CANAL).not.toContain(nome);
    }
  });

  it("inclui exatamente os 5 canais comerciais reais", () => {
    expect(ORDEM_CANAL).toEqual(["CD", "Leblon", "Rio Sul", "Barra", "ATACADO"]);
  });
});

const stores = [
  { id: "s-cd", code: "CD", name: "TVB Site e Atacado" },
  { id: "s-leblon", code: "Leblon", name: "Leblon" },
  { id: "s-riosul", code: "Rio Sul", name: "Rio Sul" },
  { id: "s-barra", code: "Barra", name: "Barra" },
  { id: "s-atacado", code: "ATACADO", name: "ATACADO" },
];

describe("montarVendasPorCanal", () => {
  it("nunca soma CD e ATACADO juntos, mesmo os dois usando displayGroup iguais na base", () => {
    const rows = montarVendasPorCanal(
      stores,
      [
        { storeId: "s-cd", units: 10, revenue: 1000 },
        { storeId: "s-atacado", units: 50, revenue: 5000 },
      ],
      [],
      new Map()
    );
    const cd = rows.find((r) => r.code === "CD");
    const atacado = rows.find((r) => r.code === "ATACADO");
    expect(cd?.revenue).toBe(1000);
    expect(atacado?.revenue).toBe(5000);
    // Cada canal aparece como linha própria — nunca uma linha só somando os dois.
    expect(rows).toHaveLength(5);
  });

  it("desconta devolução por loja (líquido), nunca bruto", () => {
    const rows = montarVendasPorCanal(
      stores,
      [{ storeId: "s-leblon", units: 20, revenue: 2000 }],
      [{ storeId: "s-leblon", units: 5, value: 500 }],
      new Map([["s-leblon", 4]])
    );
    const leblon = rows.find((r) => r.code === "Leblon");
    expect(leblon?.unitsSold).toBe(15);
    expect(leblon?.revenue).toBe(1500);
    expect(leblon?.ticketMedio).toBe(375);
  });

  it("loja sem nenhuma venda/devolução no período aparece com zero, não fica oculta", () => {
    const rows = montarVendasPorCanal(stores, [], [], new Map());
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.unitsSold).toBe(0);
      expect(r.revenue).toBe(0);
      expect(r.ticketMedio).toBeNull();
    }
  });

  it("segue a ordem fixa CD, Leblon, Rio Sul, Barra, ATACADO", () => {
    const rows = montarVendasPorCanal(stores, [], [], new Map());
    expect(rows.map((r) => r.code)).toEqual(["CD", "Leblon", "Rio Sul", "Barra", "ATACADO"]);
  });

  it("loja fora da ordem fixa (ex: armazém novo) aparece depois, nunca escondida", () => {
    const comNovaLoja = [...stores, { id: "s-novo", code: "Conserto", name: "Conserto" }];
    const rows = montarVendasPorCanal(comNovaLoja, [], [], new Map());
    expect(rows).toHaveLength(6);
    expect(rows[rows.length - 1].code).toBe("Conserto");
  });

  it("nome de exibição do CD vira 'Site (CD)', nunca o displayGroup agrupado", () => {
    const rows = montarVendasPorCanal(stores, [], [], new Map());
    const cd = rows.find((r) => r.code === "CD");
    expect(cd?.nome).toBe("Site (CD)");
  });
});

describe("montarProdutosBlackFriday — classificação por Coleção (Sale.colecao)", () => {
  it("produto sem nenhuma venda com coleção preenchida cai em SEM_CLASSIFICACAO, nunca inventa por volume/receita", () => {
    const liquido = [
      { grupo: "Camisa", key: "Camisa Classic", unitsSold: 500, revenue: 50000 }, // alto volume/receita
      { grupo: "Shorts", key: "Shorts Liso", unitsSold: 1, revenue: 10 }, // baixo volume/receita
    ];
    const colecoes = new Map<string, string[]>(); // nenhuma coleção vista no período
    const rows = montarProdutosBlackFriday(liquido, colecoes);
    for (const r of rows) {
      expect(r.classificacao).toBe("SEM_CLASSIFICACAO");
    }
  });

  it("coleção 'Bestseller' (case-insensitive) classifica BEST_SELLER; qualquer outra coleção classifica DROP", () => {
    const liquido = [
      { grupo: "Camisa", key: "Camisa Classic", unitsSold: 500, revenue: 50000 },
      { grupo: "Shorts", key: "Shorts Liso", unitsSold: 1, revenue: 10 },
    ];
    const colecoes = new Map<string, string[]>([
      ["Camisa::Camisa Classic", ["Drop1 Inverno.26"]],
      ["Shorts::Shorts Liso", ["bestseller"]], // minúsculo de propósito — precisa normalizar
    ]);
    const rows = montarProdutosBlackFriday(liquido, colecoes);
    const camisa = rows.find((r) => r.produto === "Camisa Classic");
    const shorts = rows.find((r) => r.produto === "Shorts Liso");
    expect(camisa?.classificacao).toBe("DROP");
    expect(shorts?.classificacao).toBe("BEST_SELLER");
  });

  it("só usa a coleção quando a chave grupo::produto bate exatamente — não casa parcial nem por produto isolado", () => {
    const liquido = [{ grupo: "Camisa", key: "Camisa Classic", unitsSold: 10, revenue: 1000 }];
    const colecoes = new Map<string, string[]>([["OutroGrupo::Camisa Classic", ["BESTSELLER"]]]);
    const rows = montarProdutosBlackFriday(liquido, colecoes);
    expect(rows[0].classificacao).toBe("SEM_CLASSIFICACAO");
  });

  it("produto com vendas em mais de uma coleção no período é BEST_SELLER se QUALQUER uma delas for Bestseller", () => {
    const liquido = [{ grupo: "Camisa", key: "Camisa Classic", unitsSold: 10, revenue: 1000 }];
    const colecoes = new Map<string, string[]>([["Camisa::Camisa Classic", ["Verão 27", "BESTSELLER"]]]);
    const rows = montarProdutosBlackFriday(liquido, colecoes);
    expect(rows[0].classificacao).toBe("BEST_SELLER");
  });
});

// Pedido do Rodrigo (2026-11-05): "não contabilizar atacado na aba de central black friday" —
// excluirAtacado é a função pura usada pra montar o filtro passado a getResumoBlackFriday/
// getTopProdutosBlackFriday/getSalesByDay (NUNCA a getVendasPorCanal, que precisa continuar
// mostrando Atacado como canal próprio).
describe("excluirAtacado", () => {
  const base: DashboardFilters = { from: new Date("2026-11-01"), to: new Date("2026-11-30") };
  const todasLojas = ["s-cd", "s-leblon", "s-riosul", "s-barra", "s-atacado"];

  it("sem restrição de loja (storeIds undefined), expande pra todas as lojas menos Atacado", () => {
    const result = excluirAtacado(base, "s-atacado", todasLojas);
    expect(result.storeIds).toEqual(["s-cd", "s-leblon", "s-riosul", "s-barra"]);
  });

  it("com lojas específicas já selecionadas e sem Atacado entre elas, não altera nada", () => {
    const filtros: DashboardFilters = { ...base, storeIds: ["s-leblon", "s-barra"] };
    const result = excluirAtacado(filtros, "s-atacado", todasLojas);
    expect(result.storeIds).toEqual(["s-leblon", "s-barra"]);
  });

  it("com Atacado explicitamente entre as lojas selecionadas, remove só ele", () => {
    const filtros: DashboardFilters = { ...base, storeIds: ["s-leblon", "s-atacado", "s-barra"] };
    const result = excluirAtacado(filtros, "s-atacado", todasLojas);
    expect(result.storeIds).toEqual(["s-leblon", "s-barra"]);
  });

  it("se a loja ATACADO não existir no ambiente (id null), devolve o filtro sem alteração", () => {
    const result = excluirAtacado(base, null, todasLojas);
    expect(result).toBe(base);
  });

  it("filtro já restrito a só Atacado vira lista vazia (nada a mostrar), não volta a 'sem restrição'", () => {
    const filtros: DashboardFilters = { ...base, storeIds: ["s-atacado"] };
    const result = excluirAtacado(filtros, "s-atacado", todasLojas);
    expect(result.storeIds).toEqual([]);
  });
});

// Painel "vendas por faixa de desconto" (pedido do Rodrigo, 2026-11-06) — cruza venda líquida
// com o desconto real cadastrado em PrecoBlackFriday (planilha importada). Desde 2026-11-06,
// produto sem linha cadastrada conta como 0% e se junta ao bucket 0% real (não vira mais uma
// linha própria de "sem cadastro").
describe("montarVendasPorFaixaDesconto", () => {
  it("produto sem linha correspondente em PrecoBlackFriday cai no bucket 0%, junto com produtos que têm desconto=0 explícito", () => {
    const liquido = [
      { grupo: "Camisa", key: "Camisa Sem Preço", unitsSold: 10, revenue: 1000 }, // sem linha na planilha
      { grupo: "Camisa", key: "Camisa Desconto Zero", unitsSold: 4, revenue: 400 }, // desconto=0 explícito
    ];
    const precos = new Map<string, number>([["Camisa::Camisa Desconto Zero", 0]]);
    const rows = montarVendasPorFaixaDesconto(liquido, precos, [0, 0.1, 0.2]);

    // Nunca mais existe um bucket null/"sem cadastro" — tudo que não bate vira 0%.
    expect(rows.find((r) => r.desconto === null)).toBeUndefined();

    const faixaZero = rows.find((r) => r.desconto === 0);
    expect(faixaZero).toBeDefined();
    expect(faixaZero?.label).toBe("0%");
    // Uma ÚNICA linha, com os dois produtos somados — não duas linhas separadas.
    expect(faixaZero?.unitsSold).toBe(14);
    expect(faixaZero?.revenue).toBe(1400);
    expect(faixaZero?.produtosDistintos).toBe(2);
    expect(faixaZero?.produtos).toHaveLength(2);
  });

  it("garante o bucket 0% mesmo que a planilha não tenha nenhuma linha com desconto=0 cadastrado", () => {
    const liquido = [{ grupo: "Camisa", key: "Camisa Sem Preço", unitsSold: 10, revenue: 1000 }];
    const precos = new Map<string, number>(); // nenhum preço cadastrado pra esse produto
    const rows = montarVendasPorFaixaDesconto(liquido, precos, [0.1, 0.2]); // faixasReais sem 0

    const faixaZero = rows.find((r) => r.desconto === 0);
    expect(faixaZero).toBeDefined();
    expect(faixaZero?.unitsSold).toBe(10);
    expect(faixaZero?.revenue).toBe(1000);
  });

  it("agrega venda líquida (já descontada devolução, via netByReturns) corretamente por faixa", () => {
    const liquido = [
      { grupo: "Camisa", key: "Camisa A", unitsSold: 8, revenue: 800 }, // já líquido: 10 vendidas - 2 devolvidas
      { grupo: "Camisa", key: "Camisa B", unitsSold: 5, revenue: 500 },
    ];
    const precos = new Map<string, number>([
      ["Camisa::Camisa A", 0.2],
      ["Camisa::Camisa B", 0.2],
    ]);
    const rows = montarVendasPorFaixaDesconto(liquido, precos, [0.2]);
    const faixa20 = rows.find((r) => r.desconto === 0.2);
    expect(faixa20?.unitsSold).toBe(13);
    expect(faixa20?.revenue).toBe(1300);
    expect(faixa20?.produtosDistintos).toBe(2);
    expect(faixa20?.precoMedioLiquido).toBeCloseTo(100);
  });

  it("faixa real cadastrada sem nenhuma venda no período aparece com zero, não fica omitida", () => {
    const rows = montarVendasPorFaixaDesconto([], new Map(), [0, 0.1, 0.45]);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.unitsSold).toBe(0);
      expect(r.revenue).toBe(0);
      expect(r.produtosDistintos).toBe(0);
      expect(r.precoMedioLiquido).toBeNull();
      expect(r.produtos).toEqual([]);
    }
  });

  it("ordena por desconto ascendente", () => {
    const liquido = [{ grupo: "G", key: "P", unitsSold: 1, revenue: 1 }];
    const precos = new Map<string, number>(); // cai em 0%
    const rows = montarVendasPorFaixaDesconto(liquido, precos, [0.3, 0.1, 0.45, 0]);
    expect(rows.map((r) => r.desconto)).toEqual([0, 0.1, 0.3, 0.45]);
  });

  it("rótulo de porcentagem bate com o valor decimal cadastrado (0.15 -> '15%')", () => {
    const rows = montarVendasPorFaixaDesconto([], new Map(), [0.15]);
    expect(rows.find((r) => r.desconto === 0.15)?.label).toBe("15%");
  });

  it("produtos dentro de cada faixa vêm ordenados por receita líquida decrescente", () => {
    const liquido = [
      { grupo: "Camisa", key: "Camisa Baixa Receita", unitsSold: 1, revenue: 100 },
      { grupo: "Camisa", key: "Camisa Alta Receita", unitsSold: 1, revenue: 900 },
      { grupo: "Camisa", key: "Camisa Media Receita", unitsSold: 1, revenue: 500 },
    ];
    const precos = new Map<string, number>([
      ["Camisa::Camisa Baixa Receita", 0.1],
      ["Camisa::Camisa Alta Receita", 0.1],
      ["Camisa::Camisa Media Receita", 0.1],
    ]);
    const rows = montarVendasPorFaixaDesconto(liquido, precos, [0.1]);
    const faixa10 = rows.find((r) => r.desconto === 0.1);
    expect(faixa10?.produtos.map((p) => p.produto)).toEqual([
      "Camisa Alta Receita",
      "Camisa Media Receita",
      "Camisa Baixa Receita",
    ]);
  });
});

describe("periodoAnterior", () => {
  it("devolve uma janela anterior com a mesma duração, sem sobrepor o período atual", () => {
    const from = new Date("2026-11-20T00:00:00.000-03:00");
    const to = new Date("2026-11-26T23:59:59.999-03:00");
    const anterior = periodoAnterior(from, to);
    const duracaoAtual = to.getTime() - from.getTime();
    const duracaoAnterior = anterior.to.getTime() - anterior.from.getTime();
    expect(duracaoAnterior).toBe(duracaoAtual);
    expect(anterior.to.getTime()).toBeLessThan(from.getTime());
  });
});

// Pedido do Rodrigo (2026-11-06): ROAS era "blended" — receita de TODAS as lojas (menos Atacado)
// sobre o gasto total do Meta Ads, não um ROAS de canal de verdade. Corrigido pra usar só a
// receita líquida do e-commerce (Store.code="CD") no numerador.
describe("getResumoBlackFriday — roas usa só a receita do e-commerce (CD), não a receita blended de todas as lojas", () => {
  const CD_STORE_ID = "store-cd-123";
  const FROM = new Date("2026-11-01T00:00:00-03:00");
  const TO = new Date("2026-11-30T23:59:59-03:00");

  beforeEach(() => {
    storeFindFirst.mockReset();
    saleAggregate.mockReset();
    saleGroupBy.mockReset();
    returnAggregate.mockReset();
    getInsightsPorConjunto.mockReset();
    storeFindFirst.mockResolvedValue({ id: CD_STORE_ID });
    saleGroupBy.mockResolvedValue([{ storeId: CD_STORE_ID, dapicVendaId: 1 }]);
    returnAggregate.mockResolvedValue({ _sum: { valorTotal: 0, quantidade: 0 } });
    getInsightsPorConjunto.mockResolvedValue(
      new Map([
        [
          "Conjunto A",
          { gasto: 1000, impressoes: 0, alcance: 0, cliques: 0, ctrPct: 0, cpc: 0, cpm: 0, compras: 0, roas: null, custoPorCompra: null },
        ],
      ])
    );
  });

  it("empresa inteira (menos Atacado) fatura 10000, mas só o CD fatura 4000 -> roas = 4000/1000, nunca 10000/1000", async () => {
    saleAggregate.mockImplementation(
      async ({ where }: { where: { storeId?: { in: string[] } } }) => {
        if (where.storeId?.in?.includes(CD_STORE_ID)) {
          return { _sum: { valorTotalLiquido: 4000, quantidade: 40 } };
        }
        return { _sum: { valorTotalLiquido: 10000, quantidade: 100 } }; // blended: todas as lojas
      }
    );

    const r = await getResumoBlackFriday({ from: FROM, to: TO });

    // faturamento/pecas continuam company-wide (minus Atacado) — só roas mudou de definição.
    expect(r.faturamento).toBe(10000);
    expect(r.investimentoMidia).toBe(1000);
    expect(r.roas).toBe(4); // 4000 (só CD) / 1000, nunca 10000/1000=10
  });

  it("permissão do usuário já exclui a loja CD inteiramente -> roas vira null, nunca calcula com dado que ele não pode ver", async () => {
    saleAggregate.mockResolvedValue({ _sum: { valorTotalLiquido: 2000, quantidade: 20 } });

    const r = await getResumoBlackFriday({ from: FROM, to: TO, storeIds: ["store-leblon"] });

    expect(r.roas).toBeNull();
    // Nunca chega a consultar Sale restrito ao storeId do CD (permissão não inclui essa loja).
    for (const call of saleAggregate.mock.calls) {
      const where = call[0].where as { storeId?: { in: string[] } };
      expect(where.storeId?.in?.includes(CD_STORE_ID)).not.toBe(true);
    }
  });

  it("loja CD não existe no ambiente (sync de lojas nunca rodou) -> roas vira null, nunca quebra nem mostra 0", async () => {
    storeFindFirst.mockResolvedValue(null);
    saleAggregate.mockResolvedValue({ _sum: { valorTotalLiquido: 5000, quantidade: 50 } });

    const r = await getResumoBlackFriday({ from: FROM, to: TO });

    expect(r.roas).toBeNull();
  });

  it("investimento indisponível (Meta Ads falhou) -> roas null mesmo com faturamento do CD disponível", async () => {
    saleAggregate.mockResolvedValue({ _sum: { valorTotalLiquido: 5000, quantidade: 50 } });
    getInsightsPorConjunto.mockRejectedValue(new Error("META_AD_ACCOUNT_ID / META_ACCESS_TOKEN não configurados"));

    const r = await getResumoBlackFriday({ from: FROM, to: TO });

    expect(r.investimentoIndisponivel).toBe(true);
    expect(r.roas).toBeNull();
  });
});

// Painel "Meta vs. Real" da campanha (pedido do Rodrigo, 2026-11-06, "só o periodo da black") —
// cruza a meta diária/real 2025 da planilha (MetaDiariaBlackFriday) com o faturamento real 2026
// (getSalesByDay). montarComparativoMetaDiariaBlackFriday é a função PURA que faz a matemática;
// getComparativoMetaDiariaBlackFriday (testado em describe próprio abaixo) é só o encanamento de
// banco em volta dela.
describe("montarComparativoMetaDiariaBlackFriday", () => {
  it("calcula % atingimento, diferença em R$ e crescimento anual com fixtures realistas", () => {
    const metas = [
      { data: "2026-11-10", metaReceita2026: 175000, receitaReal2025: 3929.55, acao: "Lançamento Oficial" },
    ];
    const receitaRealPorDia = new Map([["2026-11-10", 200000]]);

    const resumo = montarComparativoMetaDiariaBlackFriday(metas, receitaRealPorDia);

    expect(resumo.dias).toHaveLength(1);
    const dia = resumo.dias[0];
    expect(dia.receitaReal2026).toBe(200000);
    expect(dia.atingimentoPct).toBeCloseTo((200000 / 175000) * 100, 5); // ~114.29%
    expect(dia.diferencaReal).toBe(200000 - 175000); // 25000, bateu a meta
    expect(dia.crescimentoAnualPct).toBeCloseTo(((200000 - 3929.55) / 3929.55) * 100, 5); // crescimento gigante, mas é o real
  });

  it("dia sem venda registrada ainda conta como 0 de receita real (não null) — abaixo da meta, nunca quebra", () => {
    const metas = [{ data: "2026-11-15", metaReceita2026: 53000, receitaReal2025: 38899.13, acao: null }];
    const resumo = montarComparativoMetaDiariaBlackFriday(metas, new Map()); // nenhuma venda ainda nesse dia

    const dia = resumo.dias[0];
    expect(dia.receitaReal2026).toBe(0);
    expect(dia.atingimentoPct).toBe(0);
    expect(dia.diferencaReal).toBe(-53000);
  });

  it("dia SEM dado de 2025 na planilha mostra indisponível (null), nunca fabrica 0% de crescimento", () => {
    const metas = [{ data: "2026-11-20", metaReceita2026: 30000, receitaReal2025: null, acao: null }];
    const receitaRealPorDia = new Map([["2026-11-20", 25000]]);

    const resumo = montarComparativoMetaDiariaBlackFriday(metas, receitaRealPorDia);

    const dia = resumo.dias[0];
    expect(dia.receitaReal2025).toBeNull();
    expect(dia.crescimentoAnualPct).toBeNull(); // nunca "caiu 100%" ou qualquer número inventado
    // mas o atingimento da meta 2026 (que não depende de 2025) continua calculado normalmente.
    expect(dia.atingimentoPct).toBeCloseTo((25000 / 30000) * 100, 5);
  });

  it("acumulado soma todos os dias cadastrados (meta, real, diferença) e calcula % atingimento acumulado", () => {
    const metas = [
      { data: "2026-11-01", metaReceita2026: 5000, receitaReal2025: 2927.08, acao: null },
      { data: "2026-11-02", metaReceita2026: 5000, receitaReal2025: 1800.72, acao: null },
    ];
    const receitaRealPorDia = new Map([
      ["2026-11-01", 6000],
      ["2026-11-02", 2000],
    ]);

    const resumo = montarComparativoMetaDiariaBlackFriday(metas, receitaRealPorDia);

    expect(resumo.acumulado.metaReceita2026).toBe(10000);
    expect(resumo.acumulado.receitaReal2026).toBe(8000);
    expect(resumo.acumulado.diferencaReal).toBe(-2000);
    expect(resumo.acumulado.atingimentoPct).toBeCloseTo(80, 5);
  });

  it("ordena os dias por data mesmo que as metas cheguem fora de ordem", () => {
    const metas = [
      { data: "2026-11-02", metaReceita2026: 5000, receitaReal2025: null, acao: null },
      { data: "2026-11-01", metaReceita2026: 5000, receitaReal2025: null, acao: null },
    ];
    const resumo = montarComparativoMetaDiariaBlackFriday(metas, new Map());
    expect(resumo.dias.map((d) => d.data)).toEqual(["2026-11-01", "2026-11-02"]);
  });

  it("hojeStr resolve o bloco 'hoje' quando a data cai dentro da janela cadastrada", () => {
    const metas = [
      { data: "2026-11-10", metaReceita2026: 175000, receitaReal2025: 3929.55, acao: "Lançamento Oficial" },
      { data: "2026-11-11", metaReceita2026: 130000, receitaReal2025: 133335.47, acao: null },
    ];
    const resumo = montarComparativoMetaDiariaBlackFriday(metas, new Map([["2026-11-11", 140000]]), "2026-11-11");
    expect(resumo.hoje?.data).toBe("2026-11-11");
    expect(resumo.hoje?.receitaReal2026).toBe(140000);
  });

  it("hojeStr fora da janela cadastrada (campanha não começou/já terminou) -> hoje é null, nunca inventa um dia", () => {
    const metas = [{ data: "2026-11-10", metaReceita2026: 175000, receitaReal2025: 3929.55, acao: null }];
    const resumo = montarComparativoMetaDiariaBlackFriday(metas, new Map(), "2026-10-01");
    expect(resumo.hoje).toBeNull();
  });

  it("sem hojeStr (não informado) -> hoje é null por padrão", () => {
    const metas = [{ data: "2026-11-10", metaReceita2026: 175000, receitaReal2025: 3929.55, acao: null }];
    const resumo = montarComparativoMetaDiariaBlackFriday(metas, new Map());
    expect(resumo.hoje).toBeNull();
  });
});

describe("encontrarDiaPorData", () => {
  it("acha a linha cuja data bate exatamente", () => {
    const dias = [
      { data: "2026-11-01", metaReceita2026: 5000, receitaReal2026: 6000, atingimentoPct: 120, diferencaReal: 1000, receitaReal2025: null, crescimentoAnualPct: null, acao: null },
      { data: "2026-11-02", metaReceita2026: 5000, receitaReal2026: 2000, atingimentoPct: 40, diferencaReal: -3000, receitaReal2025: null, crescimentoAnualPct: null, acao: null },
    ];
    expect(encontrarDiaPorData(dias, "2026-11-02")?.receitaReal2026).toBe(2000);
    expect(encontrarDiaPorData(dias, "2026-12-25")).toBeNull();
  });
});

// getComparativoMetaDiariaBlackFriday (versão async) — só confirma o encanamento: usa a janela
// MIN/MAX de MetaDiariaBlackFriday (não o período do seletor da página) e repassa `filters`
// (storeIds já SEM Atacado, decidido por quem chama) pra getSalesByDay sem alterar storeIds —
// mesmo contrato de getResumoBlackFriday/getVendasPorFaixaDesconto nesta mesma tela (ver
// comentário da função). A matemática em si já está cobrida por montarComparativoMetaDiariaBlackFriday
// acima.
describe("getComparativoMetaDiariaBlackFriday — encanamento (janela da planilha, Atacado passa intacto)", () => {
  beforeEach(() => {
    metaDiariaBlackFridayFindMany.mockReset();
    getSalesByDay.mockReset();
  });

  it("usa a janela min/max de MetaDiariaBlackFriday pra chamar getSalesByDay, não o from/to do filtro recebido", async () => {
    metaDiariaBlackFridayFindMany.mockResolvedValue([
      { data: new Date("2026-11-01T03:00:00.000Z"), metaReceita2026: 5000, receitaReal2025: 2927.08, acao: null },
      { data: new Date("2026-11-02T03:00:00.000Z"), metaReceita2026: 5000, receitaReal2025: 1800.72, acao: null },
    ]);
    getSalesByDay.mockResolvedValue([{ day: "2026-11-01", unitsSold: 1, revenue: 6000 }]);

    // filters.from/to é um período qualquer do seletor da página, bem diferente da janela da
    // planilha — a função deve ignorar esse from/to e usar a janela cadastrada.
    const filtrosSemAtacado: DashboardFilters = {
      from: new Date("2025-01-01T00:00:00-03:00"),
      to: new Date("2025-01-31T23:59:59-03:00"),
      storeIds: ["s-cd", "s-leblon", "s-riosul", "s-barra"], // já sem ATACADO
    };

    const resumo = await getComparativoMetaDiariaBlackFriday(filtrosSemAtacado);

    expect(getSalesByDay).toHaveBeenCalledTimes(1);
    const filtrosRecebidos = getSalesByDay.mock.calls[0][0] as DashboardFilters;
    expect(filtrosRecebidos.from.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(filtrosRecebidos.to.getTime()).toBeGreaterThan(new Date("2026-11-02T03:00:00.000Z").getTime());
    // Atacado continua excluído — storeIds repassado INTACTO, não resolvido/expandido de novo aqui.
    expect(filtrosRecebidos.storeIds).toEqual(["s-cd", "s-leblon", "s-riosul", "s-barra"]);

    expect(resumo.dias).toHaveLength(2);
    expect(resumo.dias[0].receitaReal2026).toBe(6000);
    expect(resumo.dias[1].receitaReal2026).toBe(0); // 2026-11-02 sem venda no mock -> 0, não quebra
  });

  it("nenhuma meta cadastrada ainda -> devolve vazio sem nunca chamar getSalesByDay", async () => {
    metaDiariaBlackFridayFindMany.mockResolvedValue([]);

    const resumo = await getComparativoMetaDiariaBlackFriday({ from: new Date(), to: new Date() });

    expect(resumo.dias).toEqual([]);
    expect(resumo.hoje).toBeNull();
    expect(resumo.acumulado).toEqual({ metaReceita2026: 0, receitaReal2026: 0, atingimentoPct: null, diferencaReal: 0 });
    expect(getSalesByDay).not.toHaveBeenCalled();
  });
});

// Mapa de estados — e-commerce (CD). Pedido do Rodrigo (2026-11-06): reaproveitar o BrazilMap já
// usado na aba Vendas, escopado SÓ à loja CD (mais estreito que o resto da tela), com pedido sem
// UF identificada isolado numa categoria própria — nunca distribuído entre os estados conhecidos.
describe("montarVendasPorEstadoEcommerce", () => {
  it("agrupa receita/unidades por estado e por cidade dentro do estado", () => {
    const r = montarVendasPorEstadoEcommerce(
      [
        { estado: "RJ", cidade: "Rio de Janeiro", unidades: 10, receita: 1000 },
        { estado: "RJ", cidade: "Niterói", unidades: 2, receita: 200 },
        { estado: "SP", cidade: "São Paulo", unidades: 5, receita: 500 },
      ],
      [],
      0
    );
    const rj = r.rows.find((x) => x.estado === "RJ");
    const sp = r.rows.find((x) => x.estado === "SP");
    expect(rj?.receita).toBe(1200);
    expect(rj?.unidades).toBe(12);
    expect(sp?.receita).toBe(500);
    expect(r.citiesByState.get("RJ")).toEqual([
      { cidade: "Rio de Janeiro", receita: 1000, unidades: 10 },
      { cidade: "Niterói", receita: 200, unidades: 2 },
    ]);
  });

  it("pedido sem UF identificada (estado null) nunca é distribuído entre os estados conhecidos — fica isolado em semEstado", () => {
    const r = montarVendasPorEstadoEcommerce(
      [
        { estado: "RJ", cidade: "Rio de Janeiro", unidades: 10, receita: 1000 },
        { estado: null, cidade: null, unidades: 3, receita: 300 },
        { estado: null, cidade: "Alguma Cidade", unidades: 1, receita: 100 },
      ],
      [],
      0
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].estado).toBe("RJ");
    expect(r.semEstado).toEqual({ receita: 400, unidades: 4, pedidos: 0 });
    // receitaBrutaTotal soma estados conhecidos + semEstado, nunca esconde o sem-UF do total.
    expect(r.receitaBrutaTotal).toBe(1400);
  });

  it("estado conhecido mas cidade null entra no total do estado sem aparecer como entrada de cidade", () => {
    const r = montarVendasPorEstadoEcommerce(
      [{ estado: "MG", cidade: null, unidades: 4, receita: 400 }],
      [],
      0
    );
    const mg = r.rows.find((x) => x.estado === "MG");
    expect(mg?.receita).toBe(400);
    expect(r.citiesByState.get("MG")).toBeUndefined();
  });

  it("conta pedidos distintos por estado (uma linha por (estado, dapicVendaId)) e calcula ticket médio", () => {
    const r = montarVendasPorEstadoEcommerce(
      [{ estado: "RJ", cidade: "Rio de Janeiro", unidades: 10, receita: 1000 }],
      [{ estado: "RJ" }, { estado: "RJ" }, { estado: null }],
      0
    );
    const rj = r.rows.find((x) => x.estado === "RJ");
    expect(rj?.pedidos).toBe(2);
    expect(rj?.ticketMedio).toBe(500);
    expect(r.semEstado.pedidos).toBe(1);
  });

  it("estado sem nenhum pedido contado (groupBy de pedidos não trouxe linha) tem ticketMedio null, não divide por zero", () => {
    const r = montarVendasPorEstadoEcommerce(
      [{ estado: "BA", cidade: "Salvador", unidades: 1, receita: 100 }],
      [],
      0
    );
    const ba = r.rows.find((x) => x.estado === "BA");
    expect(ba?.pedidos).toBe(0);
    expect(ba?.ticketMedio).toBeNull();
  });

  it("devolução do período entra só como total agregado (devolucaoTotal), nunca rateada por estado", () => {
    const r = montarVendasPorEstadoEcommerce(
      [{ estado: "RJ", cidade: "Rio de Janeiro", unidades: 10, receita: 1000 }],
      [],
      250
    );
    expect(r.devolucaoTotal).toBe(250);
    // Linha por estado continua bruta — devolução não aparece descontada aqui.
    expect(r.rows[0].receita).toBe(1000);
  });

  it("sem nenhuma venda no período devolve tudo zerado/vazio, sem quebrar", () => {
    const r = montarVendasPorEstadoEcommerce([], [], 0);
    expect(r.rows).toEqual([]);
    expect(r.citiesByState.size).toBe(0);
    expect(r.semEstado).toEqual({ receita: 0, unidades: 0, pedidos: 0 });
    expect(r.receitaBrutaTotal).toBe(0);
  });
});

// Painel "Top 20 produtos com desconto real" (pedido do Rodrigo, 2026-11-06, corrigido no mesmo
// dia: "o top 20 produtos é produto, não tamanho" — era por SKU, virou grupo+produto; desconto
// agora vem do CADASTRADO em PrecoBlackFriday, nunca calculado por preço de referência).
describe("montarTop20ProdutosComDesconto", () => {
  it("lê % desconto direto do cadastro (PrecoBlackFriday)", () => {
    const liquido = [{ grupo: "Camisa", key: "Camisa Classic", unitsSold: 10, revenue: 2000 }];
    const descontos = new Map([["Camisa::Camisa Classic", 0.2]]);
    const rows = montarTop20ProdutosComDesconto(liquido, descontos, 100000);
    expect(rows[0].descontoPct).toBeCloseTo(20);
  });

  it("produto sem linha correspondente em PrecoBlackFriday mostra desconto indisponível (null), nunca fabrica 0%", () => {
    const liquido = [{ grupo: "Camisa", key: "Camisa Nova", unitsSold: 5, revenue: 500 }];
    const rows = montarTop20ProdutosComDesconto(liquido, new Map(), 10000);
    expect(rows[0].descontoPct).toBeNull();
  });

  it("ordena por receita líquida decrescente por padrão", () => {
    const liquido = [
      { grupo: "G", key: "Baixa receita", unitsSold: 100, revenue: 100 },
      { grupo: "G", key: "Alta receita", unitsSold: 1, revenue: 900 },
      { grupo: "G", key: "Média receita", unitsSold: 10, revenue: 500 },
    ];
    const rows = montarTop20ProdutosComDesconto(liquido, new Map(), 1500);
    expect(rows.map((r) => r.produto)).toEqual(["Alta receita", "Média receita", "Baixa receita"]);
  });

  it("alterando ordenarPor pra 'unidades', ordena por unidades vendidas decrescente", () => {
    const liquido = [
      { grupo: "G", key: "Poucas unidades", unitsSold: 1, revenue: 900 },
      { grupo: "G", key: "Muitas unidades", unitsSold: 100, revenue: 100 },
    ];
    const rows = montarTop20ProdutosComDesconto(liquido, new Map(), 1000, "unidades");
    expect(rows.map((r) => r.produto)).toEqual(["Muitas unidades", "Poucas unidades"]);
  });

  it("corta no limite (padrão 20), mantendo só os top N por receita", () => {
    const liquido = Array.from({ length: 25 }, (_, i) => ({
      grupo: "G",
      key: `Produto ${i}`,
      unitsSold: 1,
      revenue: 25 - i, // produto 0 tem a maior receita
    }));
    const rows = montarTop20ProdutosComDesconto(liquido, new Map(), 1000);
    expect(rows).toHaveLength(20);
    expect(rows[0].produto).toBe("Produto 0");
  });

  it("% de participação no faturamento usa o total do período passado pelo chamador, não recalcula sozinho", () => {
    const liquido = [{ grupo: "G", key: "P", unitsSold: 1, revenue: 250 }];
    const rows = montarTop20ProdutosComDesconto(liquido, new Map(), 1000); // total do período = 1000
    expect(rows[0].participacaoFaturamentoPct).toBeCloseTo(25); // 250/1000 = 25%
  });

  it("faturamento total do período zero/negativo -> participação null, nunca divide por zero", () => {
    const liquido = [{ grupo: "G", key: "P", unitsSold: 1, revenue: 250 }];
    const rows = montarTop20ProdutosComDesconto(liquido, new Map(), 0);
    expect(rows[0].participacaoFaturamentoPct).toBeNull();
  });

  it("preserva grupo/produto/unidades/receita do agregado, pra tabela não precisar de outra consulta", () => {
    const liquido = [{ grupo: "Camisa", key: "Camisa Classic", unitsSold: 5, revenue: 500 }];
    const rows = montarTop20ProdutosComDesconto(liquido, new Map(), 10000);
    expect(rows[0]).toMatchObject({ grupo: "Camisa", produto: "Camisa Classic", unitsSold: 5, revenue: 500 });
  });
});
