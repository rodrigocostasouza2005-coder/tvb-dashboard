import { describe, it, expect } from "vitest";
import { montarVendasPorCanal, montarProdutosBlackFriday, periodoAnterior, ORDEM_CANAL } from "../black-friday";

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
