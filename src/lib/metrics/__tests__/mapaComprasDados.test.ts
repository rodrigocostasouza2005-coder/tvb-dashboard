import { describe, it, expect, vi, beforeEach } from "vitest";
import { PossibilidadeReposicao, StatusComercialProduto, TipoCompraProduto } from "@prisma/client";
import { MODOS, parseModo } from "@/app/dashboard/mapa-compras/inteligencia/modos";
import {
  agregarPorProduto,
  agregarRecomendacoesPorGrupo,
  calcularSugestaoBestSeller,
  calcularSugestaoDrop,
  cruzarComDistribuicao,
} from "../compras-inteligencia";
import { analisarVariante, type LocalEstoque } from "../distribuicao-estoque";

// ---------------------------------------------------------------------------
// Banco em memória: os mocks interpretam os filtros que a camada de dados realmente manda (loja que
// vende, janela de data, status, custo > 0), então os testes pegam erro de QUERY, não só de conta.
// ---------------------------------------------------------------------------
const DIA = 86_400_000;
const agora = Date.now();
const diasAtras = (n: number) => new Date(agora - n * DIA);

type Linha = { cod: string; storeId: string; quantidade: number; data: Date; status?: string };
const db = {
  classificacoes: [] as Record<string, unknown>[],
  vendas: [] as Linha[],
  devolucoes: [] as Linha[],
  estoque: [] as { storeId: string; cod: string; cor: string | null; tamanho: string | null; quantidadeDisponivel: number; valorCusto: number | null }[],
  producao: [] as { cod: string; quantidade: number; dataFinalizacaoProducao: Date | null }[],
  metas: [] as Record<string, unknown>[],
  orcamento: null as number | null,
  lojasQueVendem: new Set(["LEB", "BAR"]),
};

type Where = Record<string, unknown> & {
  cod?: { in: string[] };
  saleDate?: { gte?: Date; lte?: Date };
  returnDate?: { gte?: Date; lte?: Date };
  status?: { not: string };
  store?: { sellsProducts: boolean };
  valorCusto?: { gt: number };
  dataFinalizacaoProducao?: null | { not: null };
  tipoCompra?: TipoCompraProduto;
};

function filtraMov(rows: Linha[], where: Where, campoData: "saleDate" | "returnDate") {
  const faixa = where[campoData] as { gte?: Date; lte?: Date } | undefined;
  return rows.filter(
    (r) =>
      (!where.cod || where.cod.in.includes(r.cod)) &&
      (!where.status || (r.status ?? "Fechada") !== where.status.not) &&
      (!faixa?.gte || r.data >= faixa.gte) &&
      (!faixa?.lte || r.data <= faixa.lte)
  );
}

function agrupa<T extends { cod: string }>(rows: T[], f: (grupo: T[]) => Record<string, unknown>) {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(r.cod, [...(m.get(r.cod) ?? []), r]);
  return [...m.entries()].map(([cod, g]) => ({ cod, ...f(g) }));
}

const movGroupBy = (rows: () => Linha[], campo: "saleDate" | "returnDate") => (args: { where: Where; _sum?: unknown; _min?: unknown }) => {
  const f = filtraMov(rows(), args.where, campo);
  if (args._min) return Promise.resolve(agrupa(f, (g) => ({ _min: { [campo]: new Date(Math.min(...g.map((x) => x.data.getTime()))) } })));
  return Promise.resolve(agrupa(f, (g) => ({ _sum: { quantidade: g.reduce((s, x) => s + x.quantidade, 0) } })));
};
const movFindMany = (rows: () => Linha[], campo: "saleDate" | "returnDate") => (args: { where: Where; distinct?: unknown }) => {
  if (args.distinct) return Promise.resolve([]); // fila de revisão: fora do escopo destes testes
  return Promise.resolve(filtraMov(rows(), args.where, campo).map((r) => ({ cod: r.cod, quantidade: r.quantidade, [campo]: r.data })));
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    classificacaoProduto: {
      findMany: (args: { where?: Where; select?: unknown }) => {
        if (args.select) return Promise.resolve([]);
        return Promise.resolve(db.classificacoes.filter((c) => !args.where?.tipoCompra || c.tipoCompra === args.where.tipoCompra));
      },
    },
    // Wrappers preguiçosos: vi.mock é içado pro topo, os helpers só existem quando a chamada acontece.
    sale: {
      groupBy: (a: Parameters<ReturnType<typeof movGroupBy>>[0]) => movGroupBy(() => db.vendas, "saleDate")(a),
      findMany: (a: Parameters<ReturnType<typeof movFindMany>>[0]) => movFindMany(() => db.vendas, "saleDate")(a),
    },
    return: {
      groupBy: (a: Parameters<ReturnType<typeof movGroupBy>>[0]) => movGroupBy(() => db.devolucoes, "returnDate")(a),
      findMany: (a: Parameters<ReturnType<typeof movFindMany>>[0]) => movFindMany(() => db.devolucoes, "returnDate")(a),
    },
    stockSnapshot: {
      groupBy: (args: { where: Where; _sum?: unknown; _avg?: unknown }) => {
        const f = db.estoque.filter(
          (e) =>
            (!args.where.cod || args.where.cod.in.includes(e.cod)) &&
            (!args.where.store || db.lojasQueVendem.has(e.storeId) === args.where.store.sellsProducts) &&
            (!args.where.valorCusto || (e.valorCusto != null && e.valorCusto > args.where.valorCusto.gt))
        );
        if (args._avg) return Promise.resolve(agrupa(f, (g) => ({ _avg: { valorCusto: g.reduce((s, x) => s + (x.valorCusto ?? 0), 0) / g.length } })));
        return Promise.resolve(agrupa(f, (g) => ({ _sum: { quantidadeDisponivel: g.reduce((s, x) => s + x.quantidadeDisponivel, 0) } })));
      },
      findMany: (args: { where?: Where }) => {
        if (!args.where?.cod) return Promise.resolve([]);
        const vistos = new Set<string>();
        return Promise.resolve(
          db.estoque.filter((e) => args.where!.cod!.in.includes(e.cod) && !vistos.has(e.cod) && vistos.add(e.cod)).map((e) => ({ cod: e.cod, cor: e.cor, tamanho: e.tamanho }))
        );
      },
    },
    productionOrder: {
      groupBy: (args: { where: Where }) => {
        const f = db.producao.filter(
          (p) =>
            (!args.where.cod || args.where.cod.in.includes(p.cod)) &&
            (args.where.dataFinalizacaoProducao === null ? p.dataFinalizacaoProducao === null : p.dataFinalizacaoProducao !== null)
        );
        return Promise.resolve(agrupa(f, (g) => ({ _sum: { quantidade: g.reduce((s, x) => s + x.quantidade, 0) } })));
      },
    },
    coberturaMeta: { findMany: () => Promise.resolve(db.metas) },
    mapaComprasConfig: { findUnique: () => Promise.resolve(db.orcamento == null ? null : { id: "global", crescimentoPct: 0, orcamentoTotalPlanejado: db.orcamento }) },
  },
}));

function classif(cod: string, tipo: TipoCompraProduto, extra: Record<string, unknown> = {}) {
  return {
    cod,
    produto: `Produto ${cod}`,
    grupo: "Classic Lisa",
    colecao: tipo === TipoCompraProduto.DROP ? "Drop Verão" : null,
    tipoCompra: tipo,
    statusComercial: StatusComercialProduto.ATIVO,
    possibilidadeReposicao: PossibilidadeReposicao.SIM,
    dataLancamento: null,
    dataEncerramentoPrevista: null,
    orcamentoDrop: null,
    ...extra,
  };
}

// venda de 1 un/dia por `dias` dias na loja (1ª venda há `dias` dias)
function vendaDiaria(cod: string, dias: number, storeId = "LEB") {
  // meio-dia de cada dia: nenhuma venda cai exatamente na fronteira da janela
  for (let i = 1; i <= dias; i++) db.vendas.push({ cod, storeId, quantidade: 1, data: diasAtras(i - 0.5) });
}

beforeEach(() => {
  db.classificacoes = [];
  db.vendas = [];
  db.devolucoes = [];
  db.estoque = [];
  db.producao = [];
  db.metas = [];
  db.orcamento = null;
});

describe("Mapa de Compras — modos", () => {
  it("preserva os seis modos de visualização", () => {
    expect(MODOS.map((m) => m.value)).toEqual(["consolidado", "best-seller", "drop", "grupo", "produto", "alertas"]);
    expect(parseModo("drop")).toBe("drop");
    expect(parseModo("qualquer-coisa")).toBe("consolidado");
    expect(parseModo(undefined)).toBe("consolidado");
  });
});

describe("Mapa de Compras — Best Seller com dados reais montados", () => {
  it("estoque de armazenador fora de venda (defeito) não reduz a necessidade de compra", async () => {
    db.classificacoes = [classif("BS1", TipoCompraProduto.BEST_SELLER)];
    vendaDiaria("BS1", 100);
    db.estoque = [
      { storeId: "LEB", cod: "BS1", cor: "Blue", tamanho: "40", quantidadeDisponivel: 2, valorCusto: 50 },
      { storeId: "DEFEITO", cod: "BS1", cor: "Blue", tamanho: "40", quantidadeDisponivel: 100, valorCusto: 50 },
    ];
    const { getRecomendacoesBestSeller } = await import("../compras-inteligencia");
    const [r] = await getRecomendacoesBestSeller({});
    expect(r.estoqueDisponivelUtilizavel).toBe(2);
    expect(r.quantidadeSugerida).toBeGreaterThan(0);
    expect(r.cor).toBe("Blue");
    expect(r.tamanho).toBe("40");
  });

  it("velocidade usa venda líquida (devolução desconta) e a meta de cobertura do grupo quando não há simulação", async () => {
    db.classificacoes = [classif("BS2", TipoCompraProduto.BEST_SELLER)];
    vendaDiaria("BS2", 100); // 56 vendas na janela de 56 dias
    for (let i = 1; i <= 28; i++) db.devolucoes.push({ cod: "BS2", storeId: "LEB", quantidade: 1, data: diasAtras(i - 0.5) });
    db.estoque = [{ storeId: "LEB", cod: "BS2", cor: null, tamanho: null, quantidadeDisponivel: 0, valorCusto: 50 }];
    db.metas = [{ grupo: "Classic Lisa", mesesCobertura: 2, estoqueSegurancaUnidades: 0, leadTimeDias: 0 }];
    const { getRecomendacoesBestSeller } = await import("../compras-inteligencia");
    const [r] = await getRecomendacoesBestSeller({});
    expect(r.vendaMediaDiaria).toBeCloseTo(0.5, 5);
    expect(r.demandaProjetadaHorizonte).toBeCloseTo(30, 5); // 0,5/dia × 60 dias da meta
    expect(r.quantidadeSugerida).toBe(30);
    expect(r.premissas.join(" ")).toMatch(/meta do grupo/);
    expect(r.rupturaAtual).toBe(true); // zerado com venda: aviso, demanda não inflada
    expect(r.vendasLiquidas.d30).toBe(30 - 28);
  });

  it("não recomenda reposição sem necessidade comprovada e não recompra o que está a caminho sem data confiável", async () => {
    db.classificacoes = [classif("BS3", TipoCompraProduto.BEST_SELLER), classif("BS4", TipoCompraProduto.BEST_SELLER)];
    vendaDiaria("BS3", 100);
    vendaDiaria("BS4", 100);
    db.estoque = [
      { storeId: "LEB", cod: "BS3", cor: null, tamanho: null, quantidadeDisponivel: 500, valorCusto: 50 },
      { storeId: "LEB", cod: "BS4", cor: null, tamanho: null, quantidadeDisponivel: 0, valorCusto: 50 },
    ];
    db.producao = [{ cod: "BS4", quantidade: 100, dataFinalizacaoProducao: null }];
    const { getRecomendacoesBestSeller } = await import("../compras-inteligencia");
    const rows = await getRecomendacoesBestSeller({ horizonteDiasOverride: 30 });
    expect(rows.find((r) => r.cod === "BS3")!.quantidadeSugerida).toBe(0);
    const bs4 = rows.find((r) => r.cod === "BS4")!;
    expect(bs4.avisos.join(" ")).toMatch(/sem data de recebimento confiável/);
    expect(bs4.recebimentosUtilizaveis).toBe(0);
  });

  it("custo 0 não é custo confiável: valor fica sem estimativa e a necessidade vai pra lista sem custo", async () => {
    db.classificacoes = [classif("BS5", TipoCompraProduto.BEST_SELLER)];
    vendaDiaria("BS5", 100);
    db.estoque = [{ storeId: "LEB", cod: "BS5", cor: null, tamanho: null, quantidadeDisponivel: 0, valorCusto: 0 }];
    db.orcamento = 10_000;
    const { getVisaoConsolidadaCompras } = await import("../compras-inteligencia");
    const visao = await getVisaoConsolidadaCompras({ horizonteDiasOverride: 30 });
    const bs = visao.bestSeller[0];
    expect(bs.quantidadeSugerida).toBeGreaterThan(0);
    expect(bs.valorEstimado).toBeNull();
    expect(visao.necessidadesSemCusto.map((n) => n.cod)).toEqual(["BS5"]);
    expect(visao.itensPriorizados).toHaveLength(0);
    expect(visao.planejamentoFinanceiroIncompleto).toBe(true);
    expect(visao.verbaSugeridaTotal).toBe(0);
  });

  it("respeita o orçamento e identifica o que excede", async () => {
    db.classificacoes = [classif("A1", TipoCompraProduto.BEST_SELLER), classif("A2", TipoCompraProduto.BEST_SELLER)];
    vendaDiaria("A1", 100);
    vendaDiaria("A2", 100);
    db.estoque = [
      { storeId: "LEB", cod: "A1", cor: null, tamanho: null, quantidadeDisponivel: 0, valorCusto: 30 }, // 30 un × 30 = 900
      { storeId: "LEB", cod: "A2", cor: null, tamanho: null, quantidadeDisponivel: 0, valorCusto: 20 }, // 30 un × 20 = 600
    ];
    db.orcamento = 1000;
    const { getVisaoConsolidadaCompras } = await import("../compras-inteligencia");
    const visao = await getVisaoConsolidadaCompras({ horizonteDiasOverride: 30 });
    expect(visao.verbaSugeridaTotal).toBe(1500);
    expect(visao.valorAtendidoNoOrcamento).toBeLessThanOrEqual(1000);
    expect(visao.valorAtendidoNoOrcamento + visao.valorForaDoOrcamento).toBe(1500);
    expect(visao.itensPriorizados.filter((i) => !i.atendido).length).toBe(1);
    expect(visao.itensPriorizados.find((i) => !i.atendido)!.motivoNaoAtendido).toMatch(/Orçamento disponível insuficiente/);
  });
});

describe("Mapa de Compras — Drops", () => {
  it("Drop recomprável mas sem data de encerramento: janela desconhecida, nada sugerido, sem falso risco de sobra", async () => {
    db.classificacoes = [classif("D1", TipoCompraProduto.DROP, { dataLancamento: diasAtras(30) })];
    vendaDiaria("D1", 30);
    db.estoque = [{ storeId: "LEB", cod: "D1", cor: null, tamanho: null, quantidadeDisponivel: 80, valorCusto: 40 }];
    const { getRecomendacoesDrop } = await import("../compras-inteligencia");
    const [r] = await getRecomendacoesDrop({});
    expect(r.janelaConhecida).toBe(false);
    expect(r.quantidadeSugerida).toBeNull();
    expect(r.riscoSobra).toBe(false);
    expect(r.riscoRuptura).toBe(false);
    expect(r.precisaConfirmacaoHumana).toBe(true);
  });

  it("Drop com venda mas sem data de lançamento não vira 'compra inicial pelo orçamento'", async () => {
    db.classificacoes = [
      classif("D2", TipoCompraProduto.DROP, { dataEncerramentoPrevista: new Date(agora + 10.5 * DIA), orcamentoDrop: 100_000 }),
    ];
    vendaDiaria("D2", 40);
    db.estoque = [{ storeId: "LEB", cod: "D2", cor: null, tamanho: null, quantidadeDisponivel: 5, valorCusto: 50 }];
    const { getRecomendacoesDrop } = await import("../compras-inteligencia");
    const [r] = await getRecomendacoesDrop({});
    expect(r.diasDesdeLancamento).toBe(39); // 1ª venda há 39,5 dias
    expect(r.avisos.join(" ")).not.toMatch(/orçamento disponível ÷ custo/);
    // faltante = (40 vendas ÷ 39 dias) × 10 dias − 5 em estoque ≈ 5 (não 100.000/50 = 2.000)
    expect(r.quantidadeSugerida).toBe(5);
    expect(r.premissas.join(" ")).toMatch(/1ª venda/);
  });

  it("Drop sem reposição confirmada nunca recebe recompra, mesmo vendendo bem", async () => {
    db.classificacoes = [
      classif("D3", TipoCompraProduto.DROP, { possibilidadeReposicao: PossibilidadeReposicao.A_CONFIRMAR, dataEncerramentoPrevista: new Date(agora + 30 * DIA) }),
      classif("D4", TipoCompraProduto.DROP, { possibilidadeReposicao: PossibilidadeReposicao.NAO, dataEncerramentoPrevista: new Date(agora + 30 * DIA) }),
    ];
    vendaDiaria("D3", 60);
    vendaDiaria("D4", 60);
    const { getRecomendacoesDrop } = await import("../compras-inteligencia");
    const rows = await getRecomendacoesDrop({});
    const d3 = rows.find((r) => r.cod === "D3")!;
    const d4 = rows.find((r) => r.cod === "D4")!;
    expect(d3.riscoRuptura).toBe(true);
    expect(d3.quantidadeSugerida).toBeNull();
    expect(d4.quantidadeSugerida).toBe(0);
    expect(d4.bloqueadoRecompra).toBe(true);
  });

  it("sell-through com denominador documentado: produção finalizada quando existe, senão vendido + estoque", async () => {
    db.classificacoes = [classif("S1", TipoCompraProduto.DROP), classif("S2", TipoCompraProduto.DROP)];
    for (const cod of ["S1", "S2"]) for (let i = 1; i <= 40; i++) db.vendas.push({ cod, storeId: "LEB", quantidade: 1, data: diasAtras(i) });
    db.vendas.push({ cod: "S1", storeId: "LEB", quantidade: 10, data: diasAtras(5), status: "Cancelada" }); // cancelada não conta
    db.producao = [{ cod: "S1", quantidade: 100, dataFinalizacaoProducao: diasAtras(60) }];
    db.estoque = [
      { storeId: "LEB", cod: "S1", cor: null, tamanho: null, quantidadeDisponivel: 60, valorCusto: 40 },
      { storeId: "LEB", cod: "S2", cor: null, tamanho: null, quantidadeDisponivel: 60, valorCusto: 40 },
    ];
    const { getRecomendacoesDrop } = await import("../compras-inteligencia");
    const rows = await getRecomendacoesDrop({});
    const s1 = rows.find((r) => r.cod === "S1")!;
    const s2 = rows.find((r) => r.cod === "S2")!;
    expect(s1.sellThroughAtual).toBeCloseTo(40, 5); // 40 / 100 produzidos
    expect(s1.premissas.join(" ")).toMatch(/produção finalizada/);
    expect(s2.sellThroughAtual).toBeCloseTo(40, 5); // 40 / (40 + 60)
    expect(s2.premissas.join(" ")).toMatch(/vendido líquido \+ estoque/);
  });
});

describe("Mapa de Compras — agregação e rastreabilidade", () => {
  const bs = (cod: string, produto: string, grupo: string, qtd: number, valor: number | null, tamanho: string) => ({
    cod,
    produto,
    grupo,
    cor: "Blue",
    tamanho,
    quantidadeSugerida: qtd,
    valorEstimado: valor,
    estoqueDisponivelUtilizavel: 3,
    demandaProjetadaHorizonte: qtd + 3,
    vendaMediaDiaria: 0.5,
  });

  it("total do grupo = soma dos produtos = soma das variantes (cor/tamanho preservados)", () => {
    const bsRows = [bs("1", "Classic Blue", "Classic Lisa", 10, 500, "40"), bs("2", "Classic Blue", "Classic Lisa", 4, 200, "42"), bs("3", "Classic Black", "Classic Lisa", 6, null, "40")];
    const grupos = agregarRecomendacoesPorGrupo(bsRows, []);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].bestSeller.quantidadeSugerida).toBe(20);
    expect(grupos[0].bestSeller.valorEstimado).toBe(700);
    expect(grupos[0].bestSeller.produtosSemCusto).toBe(1);
    expect(grupos[0].bestSeller.coberturaDias).toBeCloseTo(9 / 1.5, 5);

    const produtos = agregarPorProduto(bsRows, []);
    const blue = produtos.find((p) => p.produto === "Classic Blue")!;
    expect(blue.variantes.map((v) => v.tamanho)).toEqual(["40", "42"]);
    expect(blue.quantidadeSugerida).toBe(blue.variantes.reduce((s, v) => s + (v.quantidadeSugerida ?? 0), 0));
    expect(produtos.reduce((s, p) => s + p.quantidadeSugerida, 0)).toBe(grupos[0].quantidadeSugeridaTotal);
    expect(produtos.reduce((s, p) => s + p.valorEstimado, 0)).toBe(grupos[0].valorEstimadoTotal);
    expect(produtos.find((p) => p.produto === "Classic Black")!.variantesSemCusto).toBe(1);
  });

  it("dados insuficientes não geram recomendação inventada", () => {
    const r = calcularSugestaoBestSeller({ grupo: "G", horizonteCoberturaDias: 30, vendaMediaDiaria: 5, diasHistoricoDisponivel: 5, estoqueDisponivel: 0, custoUnitario: 10 });
    expect(r.quantidadeSugerida).toBe(0);
    expect(r.confiavel).toBe(false);
    expect(r.valorEstimado).toBe(0);
  });
});

describe("Mapa de Compras × Distribuição de Estoque — coerência", () => {
  const REF = new Date(agora);
  const LOCAIS: LocalEstoque[] = [
    { storeId: "LEB", nome: "TVB Leblon", papel: "PONTO_VENDA", motivoPapel: "" },
    { storeId: "BAR", nome: "TVB Barra", papel: "PONTO_VENDA", motivoPapel: "" },
  ];
  const fatos = (storeId: string, estoque: number, vendas90: number) => ({
    storeId,
    estoqueFisico: estoque,
    estoqueReservado: null,
    vendas30: vendas90 / 3,
    vendas60: (vendas90 * 2) / 3,
    vendas90,
    devolucoes30: 0,
    devolucoes60: 0,
    devolucoes90: 0,
    brindes90: 0,
    canceladas90: 0,
    ultimaVenda: diasAtras(2),
  });
  const variante = (lojas: ReturnType<typeof fatos>[]) => ({
    cod: "V1",
    produto: "Classic Blue",
    grupo: "Classic Lisa",
    cor: "Blue",
    tamanho: "40",
    colecao: null,
    primeiraAparicao: diasAtras(400),
    fontes: ["estoque"],
    lojas,
    custoUnitario: 50,
  });
  const compraPara = (d: ReturnType<typeof analisarVariante>) =>
    calcularSugestaoBestSeller({
      grupo: "Classic Lisa",
      horizonteCoberturaDias: 60,
      vendaMediaDiaria: d.velocidadeDiariaTotal,
      diasHistoricoDisponivel: 56,
      estoqueDisponivel: d.estoqueDisponivelTotal,
      estoqueSegurancaUnidades: 0,
      leadTimeDias: 0,
      custoUnitario: 50,
    });

  it("falta em todas as lojas: distribuição aponta insuficiência global e a compra recomenda reposição", () => {
    const d = analisarVariante(variante([fatos("LEB", 1, 30), fatos("BAR", 1, 30)]), LOCAIS, REF);
    expect(d.diagnostico).toBe("ESTOQUE_TOTAL_INSUFICIENTE");
    expect(d.transferencias).toHaveLength(0);
    expect(compraPara(d).quantidadeSugerida).toBeGreaterThan(0);
  });

  it("excesso numa loja e falta noutra: transferência não muda o estoque total que a compra usa", () => {
    const d = analisarVariante(variante([fatos("LEB", 60, 9), fatos("BAR", 0, 27)]), LOCAIS, REF);
    expect(d.diagnostico).toBe("TRANSFERENCIA_POSSIVEL");
    const antes = compraPara(d);
    const totalDepois = d.lojas.reduce((s, l) => {
      const saiu = d.transferencias.filter((t) => t.origem.storeId === l.storeId).reduce((x, t) => x + t.quantidade, 0);
      const entrou = d.transferencias.filter((t) => t.destino.storeId === l.storeId).reduce((x, t) => x + t.quantidade, 0);
      return s + l.estoqueDisponivel - saiu + entrou;
    }, 0);
    expect(totalDepois).toBe(d.estoqueDisponivelTotal);
    expect(compraPara({ ...d, estoqueDisponivelTotal: totalDepois }).quantidadeSugerida).toBe(antes.quantidadeSugerida);
  });

  it("estoque folgado e equilibrado: nem transferência nem compra", () => {
    const d = analisarVariante(variante([fatos("LEB", 100, 30), fatos("BAR", 100, 30)]), LOCAIS, REF);
    expect(d.transferencias).toHaveLength(0);
    expect(compraPara(d).quantidadeSugerida).toBe(0);
  });

  it("sugestão de transferência não vira compra: cruzamento só anota, sem tocar na quantidade", () => {
    const d = analisarVariante(variante([fatos("LEB", 60, 9), fatos("BAR", 0, 27)]), LOCAIS, REF);
    const compra = compraPara(d);
    const info = cruzarComDistribuicao(["V1", "OUTRO"], [d]);
    expect(info.get("V1")!.unidadesTransferiveis).toBe(d.unidadesTransferiveis);
    expect(info.has("OUTRO")).toBe(false);
    expect(compraPara(d).quantidadeSugerida).toBe(compra.quantidadeSugerida);
    for (const t of d.transferencias) expect(t.somenteSugestao).toBe(true);
  });

  it("Drop com sobra numa loja: redistribuição sem presumir nova compra", () => {
    const drop = calcularSugestaoDrop({
      colecao: "Drop",
      grupo: "G",
      possibilidadeReposicao: PossibilidadeReposicao.NAO,
      quantidadeCompradaOriginal: 100,
      estoqueDisponivel: 60,
      vendasAcumuladas: 40,
      velocidadeVendaDiaria: 0.4,
      diasDesdeLancamento: 100,
      diasRestantesJanela: 30,
    });
    const d = analisarVariante(variante([fatos("LEB", 60, 9), fatos("BAR", 0, 27)]), LOCAIS, REF);
    expect(drop.quantidadeSugerida).toBe(0);
    expect(d.transferencias.length).toBeGreaterThan(0);
  });
});
