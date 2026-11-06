import { describe, it, expect } from "vitest";
import {
  montarVendasPorCanal,
  montarProdutosBlackFriday,
  montarVendasPorFaixaDesconto,
  periodoAnterior,
  ORDEM_CANAL,
  excluirAtacado,
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
// com o desconto real cadastrado em PrecoBlackFriday (planilha importada).
describe("montarVendasPorFaixaDesconto", () => {
  it("produto vendido sem linha correspondente em PrecoBlackFriday cai em 'Sem desconto cadastrado', nunca é descartado nem vira 0%", () => {
    const liquido = [{ grupo: "Camisa", key: "Camisa Sem Preço", unitsSold: 10, revenue: 1000 }];
    const precos = new Map<string, number>(); // nenhum preço cadastrado pra esse produto
    const rows = montarVendasPorFaixaDesconto(liquido, precos, [0.1, 0.2]);

    const semCadastro = rows.find((r) => r.desconto === null);
    expect(semCadastro).toBeDefined();
    expect(semCadastro?.label).toBe("Sem desconto cadastrado");
    expect(semCadastro?.unitsSold).toBe(10);
    expect(semCadastro?.revenue).toBe(1000);
    // Nunca aparece dentro da faixa 0% real (que é uma faixa cadastrada e diferente de "sem dado").
    const faixaZero = rows.find((r) => r.desconto === 0);
    expect(faixaZero).toBeUndefined();
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
    }
  });

  it("ordena por desconto ascendente, com 'Sem desconto cadastrado' sempre por último", () => {
    const liquido = [{ grupo: "G", key: "P", unitsSold: 1, revenue: 1 }];
    const precos = new Map<string, number>(); // cai em sem-cadastro
    const rows = montarVendasPorFaixaDesconto(liquido, precos, [0.3, 0.1, 0.45, 0]);
    expect(rows.map((r) => r.desconto)).toEqual([0, 0.1, 0.3, 0.45, null]);
  });

  it("rótulo de porcentagem bate com o valor decimal cadastrado (0.15 -> '15%')", () => {
    const rows = montarVendasPorFaixaDesconto([], new Map(), [0.15]);
    expect(rows[0].label).toBe("15%");
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
