import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  analisarVariante,
  consolidarResultado,
  executarAnaliseDistribuicao,
  iniciarExecucao,
  filtrarTransferencias,
  filtrarVariantes,
  montarUniverso,
  processarLotes,
  CONFIG_DISTRIBUICAO_PADRAO,
  type FatosLojaVariante,
  type LocalEstoque,
  type VarianteCatalogo,
  type EntradaDistribuicao,
} from "../distribuicao-estoque";

const REF = new Date("2026-10-29T12:00:00Z");
const DIA = 86_400_000;
const ANTIGO = new Date(REF.getTime() - 400 * DIA);

const LOCAIS: LocalEstoque[] = [
  { storeId: "A", nome: "TVB Leblon", papel: "PONTO_VENDA", motivoPapel: "" },
  { storeId: "B", nome: "TVB Barra", papel: "PONTO_VENDA", motivoPapel: "" },
  { storeId: "C", nome: "TVB Rio Sul", papel: "PONTO_VENDA", motivoPapel: "" },
  { storeId: "D", nome: "Produtos acabados", papel: "DEPOSITO", motivoPapel: "" },
  { storeId: "X", nome: "Defeito", papel: "EXCLUIDO", motivoPapel: "" },
];

function loja(storeId: string, estoque: number | null, vendas90: number, extra: Partial<FatosLojaVariante> = {}): FatosLojaVariante {
  return {
    storeId,
    estoqueFisico: estoque,
    estoqueReservado: null,
    vendas30: Math.round(vendas90 / 3),
    vendas60: Math.round((vendas90 * 2) / 3),
    vendas90,
    devolucoes30: 0,
    devolucoes60: 0,
    devolucoes90: 0,
    brindes90: 0,
    canceladas90: 0,
    ultimaVenda: vendas90 > 0 ? new Date(REF.getTime() - 3 * DIA) : null,
    ...extra,
  };
}

function variante(cod: string, lojas: FatosLojaVariante[], extra: Partial<VarianteCatalogo> = {}): VarianteCatalogo {
  return {
    cod,
    produto: "Classic Blue",
    grupo: "Classic Lisa",
    cor: "Blue",
    tamanho: "40",
    colecao: null,
    primeiraAparicao: ANTIGO,
    fontes: ["estoque"],
    lojas,
    custoUnitario: 59.3,
    ...extra,
  };
}

function entrada(variantes: VarianteCatalogo[]): EntradaDistribuicao {
  return { variantes, locais: LOCAIS, referencia: REF, versaoDados: "v-teste" };
}

describe("distribuição de estoque — cobertura do catálogo", () => {
  it("processa 100% do universo, inclusive pouco vendidos e SKUs sem venda, com contagens reconciliáveis", () => {
    const vs = [
      variante("1", [loja("A", 10, 30), loja("B", 10, 30), loja("C", 10, 30)]),
      variante("2", [loja("A", 3, 1)]), // pouco vendido
      variante("3", [], { produto: null, grupo: null, cor: null, tamanho: null, fontes: ["catalogo-precos"], primeiraAparicao: null }), // só no catálogo
      variante("4", [loja("D", 5, 0)], { grupo: "(sem grupo)" }), // insumo
    ];
    const r = executarAnaliseDistribuicao(entrada(vs));
    expect(r.execucao.status).toBe("COMPLETA");
    expect(r.contagens.variantesUnicas).toBe(4);
    expect(r.contagens.variantesProcessadas).toBe(4);
    expect(r.contagens.variantesPendentes).toBe(0);
    expect(r.contagens.combinacoesEsperadas).toBe(4 * 4); // 4 variantes × 4 locais analisados (Defeito fora)
    expect(r.contagens.combinacoesProcessadas).toBe(16);
    expect(r.contagens.reconciliado).toBe(true);
    // toda variante tem diagnóstico e justificativa — nada some em silêncio
    for (const v of r.variantes) {
      expect(v.diagnostico).toBeTruthy();
      expect(v.justificativa.length).toBeGreaterThan(0);
    }
    const soma = Object.values(r.contagens.porDiagnostico).reduce((s, n) => s + n, 0);
    expect(soma).toBe(4);
    expect(r.variantes.find((v) => v.cod === "2")!.diagnostico).toBe("DADOS_INSUFICIENTES");
    expect(r.variantes.find((v) => v.cod === "3")!.diagnostico).toBe("SEM_ESTOQUE_SEM_DEMANDA");
    expect(r.variantes.find((v) => v.cod === "4")!.diagnostico).toBe("NAO_APLICAVEL");
    expect(r.contagens.conclusivas + r.contagens.dadosInsuficientes + r.contagens.naoAplicaveis).toBe(4);
  });

  it("execução parcial nunca é apresentada como completa e a retomada chega ao mesmo resultado", () => {
    const vs = ["a", "b", "c", "d", "e"].map((cod) => variante(cod, [loja("A", 10, 30), loja("B", 0, 30)]));
    const ent = entrada(vs);
    const config = { ...CONFIG_DISTRIBUICAO_PADRAO, tamanhoLote: 2 };
    const parcial = processarLotes(ent, iniciarExecucao(ent), config, 1);
    expect(parcial.status).toBe("EM_PROCESSAMENTO");
    const resParcial = consolidarResultado(ent, parcial, config);
    expect(resParcial.contagens.variantesPendentes).toBe(3);
    expect(resParcial.contagens.reconciliado).toBe(false);

    const retomado = processarLotes(ent, parcial, config);
    const completo = executarAnaliseDistribuicao(ent, config);
    expect(retomado.status).toBe("COMPLETA");
    expect(retomado.resultados.map((r) => [r.cod, r.diagnostico])).toEqual(completo.variantes.map((r) => [r.cod, r.diagnostico]));
    expect(() => processarLotes({ ...ent, versaoDados: "outra" }, parcial, config)).toThrow(/versão de dados/);
  });

  it("falha numa variante é registrada com o cod, o resto continua e o status denuncia a falha", () => {
    const quebrada = variante("zz", null as unknown as FatosLojaVariante[]);
    const r = executarAnaliseDistribuicao(entrada([variante("ok", [loja("A", 5, 10)]), quebrada]));
    expect(r.execucao.status).toBe("COMPLETA_COM_FALHAS");
    expect(r.execucao.falhas.map((f) => f.cod)).toEqual(["zz"]);
    expect(r.contagens.variantesProcessadas).toBe(1);
    expect(r.contagens.variantesComFalha).toBe(1);
  });
});

describe("distribuição de estoque — separação de variantes e fontes", () => {
  it("cada tamanho é analisado sozinho (não mistura um tamanho desequilibrado com outro equilibrado)", () => {
    const tam40 = variante("40", [loja("A", 40, 9), loja("B", 0, 27), loja("C", 6, 9)], { tamanho: "40" });
    const tam42 = variante("42", [loja("A", 20, 30), loja("B", 20, 30), loja("C", 20, 30)], { tamanho: "42" });
    const r = executarAnaliseDistribuicao(entrada([tam40, tam42]));
    expect(r.contagens.produtosUnicos).toBe(1);
    expect(r.contagens.variantesUnicas).toBe(2);
    expect(r.variantes.find((v) => v.cod === "40")!.diagnostico).toBe("TRANSFERENCIA_POSSIVEL");
    expect(r.variantes.find((v) => v.cod === "42")!.diagnostico).toBe("EQUILIBRADA");
  });

  it("montarUniverso separa produto, cor, tamanho e loja; une fontes pelo cod sem duplicar", () => {
    const { variantes, locais } = montarUniverso({
      lojas: [
        { id: "A", name: "TVB Leblon", sellsProducts: true },
        { id: "D", name: "Produtos acabados", sellsProducts: true },
        { id: "X", name: "Defeito Leblon", sellsProducts: false },
      ],
      estoque: [
        { storeId: "A", cod: "100", produto: "Classic Blue", grupo: "Classic Lisa", cor: "Blue", tamanho: "40", colecao: null, quantidade: 3, valorCusto: 59 },
        { storeId: "D", cod: "100", produto: "Classic Blue", grupo: "Classic Lisa", cor: "Blue", tamanho: "40", colecao: null, quantidade: 9, valorCusto: 0 },
        { storeId: "X", cod: "100", produto: "Classic Blue", grupo: "Classic Lisa", cor: "Blue", tamanho: "40", colecao: null, quantidade: 2, valorCusto: 59 },
        { storeId: "A", cod: "101", produto: "Classic Blue", grupo: "Classic Lisa", cor: "Blue", tamanho: "42", colecao: null, quantidade: 1, valorCusto: 59 },
      ],
      movimentos: [
        { storeId: "A", cod: "100", produto: "Classic Blue", grupo: "Classic Lisa", cor: "Blue", tamanho: "40", colecao: null, vendas30: 2, vendas60: 4, vendas90: 6, brindes90: 0, canceladas90: 1, ultimaVendaJanela: REF },
        // venda numa variante que não tem linha de estoque em lugar nenhum
        { storeId: "A", cod: "200", produto: "Jam Sesh Black", grupo: "Jam Sesh", cor: "Black", tamanho: "M", colecao: "Drop X", vendas30: 1, vendas60: 1, vendas90: 1, brindes90: 0, canceladas90: 0, ultimaVendaJanela: REF },
      ],
      devolucoes: [{ storeId: "A", cod: "100", devolucoes30: 1, devolucoes60: 1, devolucoes90: 1 }],
      brindes: [],
      ultimasVendas: [{ storeId: "A", cod: "100", ultimaVenda: REF }],
      primeirasAparicoes: [{ cod: "100", data: ANTIGO }],
      codsCatalogoPrecos: ["100", "100", "999"], // duplicado entre tokens + SKU só cadastrado
    });
    expect(variantes.map((v) => v.cod).sort()).toEqual(["100", "101", "200", "999"]);
    expect(Object.fromEntries(locais.map((l) => [l.storeId, l.papel]))).toEqual({ A: "PONTO_VENDA", D: "DEPOSITO", X: "EXCLUIDO" });
    const v100 = variantes.find((v) => v.cod === "100")!;
    expect(v100.lojas.find((l) => l.storeId === "A")!.estoqueFisico).toBe(3);
    expect(v100.lojas.find((l) => l.storeId === "D")!.estoqueFisico).toBe(9);
    expect(v100.custoUnitario).toBe(59); // custo 0 não é custo confiável
    expect(v100.fontes).toEqual(expect.arrayContaining(["estoque", "vendas", "devolucoes", "catalogo-precos"]));

    const r = analisarVariante(v100, locais, REF);
    expect(r.estoqueDisponivelTotal).toBe(12); // Leblon + depósito; Defeito fora
    expect(r.estoqueForaDeVenda).toBe(2);
    expect(r.lojas.find((l) => l.storeId === "A")!.vendasLiquidas90).toBe(5); // 6 vendas − 1 devolução

    const v200 = analisarVariante(variantes.find((v) => v.cod === "200")!, locais, REF);
    expect(v200.lojas.find((l) => l.storeId === "A")!.semLinhaEstoque).toBe(true);
  });
});

describe("distribuição de estoque — diagnósticos", () => {
  it("detecta excesso numa loja e subalocação noutra e sugere transferência dentro das restrições", () => {
    const v = variante("x", [loja("A", 40, 9), loja("B", 0, 27), loja("C", 6, 9)]);
    const r = analisarVariante(v, LOCAIS, REF);
    expect(r.diagnostico).toBe("TRANSFERENCIA_POSSIVEL");
    expect(r.lojas.find((l) => l.storeId === "A")!.diagnostico).toBe("POSSIVEL_EXCESSO");
    expect(r.lojas.find((l) => l.storeId === "B")!.diagnostico).toBe("POSSIVEL_SUBALOCACAO");
    expect(r.transferencias).toHaveLength(1);
    const t = r.transferencias[0];
    expect(t.origem.storeId).toBe("A");
    expect(t.destino.storeId).toBe("B");
    // B vende 0,3/dia → precisa de 18 un para 60 dias; A (0,1/dia) protege 6 → excedente 34
    expect(t.quantidade).toBe(18);
    expect(t.origem.estoqueDisponivelDepois).toBe(22);
    expect(t.destino.coberturaDepoisDias).toBeCloseTo(60, 5);
    expect(t.somenteSugestao).toBe(true);
    expect(t.justificativa).toMatch(/TVB Barra/);
  });

  it("loja pequena zerada com demanda real é subalocação quando a empresa tem estoque (caso real ATACADO)", () => {
    // números reais de Classic Blue (2026-10-29): ATACADO 0 un / 56 vendas, 13,9% da demanda
    const v = variante("cb", [loja("A", 17, 131), loja("B", 28, 84), loja("C", 26, 64), loja("D", 844, 67), loja("X", 0, 0)]);
    const locais: LocalEstoque[] = [
      ...LOCAIS.slice(0, 3),
      { storeId: "D", nome: "CD", papel: "PONTO_VENDA", motivoPapel: "", grupoLocal: "TVB Site e Atacado" },
      { storeId: "AT", nome: "ATACADO", papel: "PONTO_VENDA", motivoPapel: "", grupoLocal: "TVB Site e Atacado" },
    ];
    const r = analisarVariante({ ...v, lojas: [...v.lojas, loja("AT", 0, 56)] }, locais, REF);
    expect(r.lojas.find((l) => l.storeId === "AT")!.diagnostico).toBe("POSSIVEL_SUBALOCACAO");
    const paraAtacado = r.transferencias.find((t) => t.destino.storeId === "AT")!;
    expect(paraAtacado.origem.storeId).toBe("D");
    expect(paraAtacado.limitacoes.join(" ")).toMatch(/mesmo grupo \(TVB Site e Atacado\)/);
    const paraLeblon = r.transferencias.find((t) => t.destino.storeId === "A")!;
    expect(paraLeblon.limitacoes.join(" ")).not.toMatch(/mesmo grupo/);
  });

  it("estoque global insuficiente não vira falsa transferência", () => {
    const v = variante("y", [loja("A", 1, 30), loja("B", 1, 30), loja("C", 0, 30)]);
    const r = analisarVariante(v, LOCAIS, REF);
    expect(r.diagnostico).toBe("ESTOQUE_TOTAL_INSUFICIENTE");
    expect(r.transferencias).toHaveLength(0);
    expect(r.justificativa.join(" ")).toMatch(/falta estoque no total/);
  });

  it("variante sem histórico: parada se antiga, dados insuficientes se recente ou de idade desconhecida", () => {
    const antiga = analisarVariante(variante("p", [loja("A", 8, 0), loja("B", 4, 0)]), LOCAIS, REF);
    expect(antiga.diagnostico).toBe("ESTOQUE_PARADO");
    expect(antiga.conclusivo).toBe(true);

    const recente = analisarVariante(variante("q", [loja("A", 8, 0)], { primeiraAparicao: new Date(REF.getTime() - 20 * DIA) }), LOCAIS, REF);
    expect(recente.diagnostico).toBe("DADOS_INSUFICIENTES");
    expect(recente.conclusivo).toBe(false);

    const semIdade = analisarVariante(variante("r", [loja("A", 8, 0)], { primeiraAparicao: null }), LOCAIS, REF);
    expect(semIdade.diagnostico).toBe("DADOS_INSUFICIENTES");
  });

  it("lançamento recente: velocidade usa só os dias de vida, não a janela de 90", () => {
    const v = variante("n", [loja("A", 20, 10), loja("B", 20, 10)], { primeiraAparicao: new Date(REF.getTime() - 20 * DIA) });
    const r = analisarVariante(v, LOCAIS, REF);
    expect(r.lojas.find((l) => l.storeId === "A")!.velocidadeDiaria).toBeCloseTo(10 / 20, 5);
    expect(r.confianca).not.toBe("ALTA"); // menos de 90 dias de vida
  });

  it("ruptura: loja zerada com histórico reduz a confiança e não extrapola venda perdida", () => {
    const v = variante("z", [loja("A", 30, 15), loja("B", 0, 15), loja("C", 30, 15)]);
    const r = analisarVariante(v, LOCAIS, REF);
    const b = r.lojas.find((l) => l.storeId === "B")!;
    expect(b.rupturaAtual).toBe(true);
    expect(b.velocidadeDiaria).toBeCloseTo(15 / 90, 5); // só o observado
    expect(r.confianca).toBe("MEDIA");
    for (const t of r.transferencias) expect(t.confianca).not.toBe("ALTA");
  });

  it("devoluções, cancelamentos e brindes não entram como venda", () => {
    const v = variante("d", [
      loja("A", 10, 10, { devolucoes90: 4, devolucoes60: 4, devolucoes30: 4, canceladas90: 7, brindes90: 5 }),
      loja("B", 10, 2, { devolucoes90: 5 }),
    ]);
    const r = analisarVariante(v, LOCAIS, REF);
    const a = r.lojas.find((l) => l.storeId === "A")!;
    expect(a.vendasLiquidas90).toBe(6);
    expect(a.canceladas90).toBe(7);
    expect(a.brindes90).toBe(5);
    const b = r.lojas.find((l) => l.storeId === "B")!;
    expect(b.vendasLiquidas90).toBe(-3);
    expect(b.velocidadeDiaria).toBe(0); // demanda nunca negativa
    expect(r.inconsistencias.join(" ")).toMatch(/Devoluções superam vendas/);
  });

  it("produto equilibrado não gera alerta nem transferência", () => {
    const v = variante("e", [loja("A", 20, 30), loja("B", 20, 30), loja("C", 20, 30)]);
    const r = analisarVariante(v, LOCAIS, REF);
    expect(r.diagnostico).toBe("EQUILIBRADA");
    expect(r.transferencias).toHaveLength(0);
    expect(r.lojas.every((l) => l.papel !== "PONTO_VENDA" || l.diagnostico === "EQUILIBRADA")).toBe(true);
  });

  it("identifica dados ausentes e inconsistentes", () => {
    const negativo = analisarVariante(variante("neg", [loja("A", -3, 10), loja("B", 10, 10)]), LOCAIS, REF);
    expect(negativo.inconsistencias.join(" ")).toMatch(/negativo/);
    expect(negativo.lojas.find((l) => l.storeId === "A")!.estoqueDisponivel).toBe(0);
    expect(negativo.confianca).not.toBe("ALTA");

    const semCorTamanho = analisarVariante(variante("s", [loja("A", 5, 10)], { cor: null, tamanho: null }), LOCAIS, REF);
    expect(semCorTamanho.limitacoes.join(" ")).toMatch(/Cor não informada/);
    expect(semCorTamanho.limitacoes.join(" ")).toMatch(/Tamanho não informado/);

    const r = executarAnaliseDistribuicao(entrada([variante("semnome", [loja("A", 5, 10)], { produto: null }), variante("ok", [loja("A", 5, 10)])]));
    expect(r.contagens.produtosComDadosAusentesOuInconsistentes).toBe(1);
  });
});

describe("distribuição de estoque — restrições das transferências", () => {
  it("nunca transfere mais que o excedente disponível na origem", () => {
    const v = variante("t", [loja("A", 8, 9), loja("B", 0, 27), loja("C", 0, 0)]);
    const r = analisarVariante(v, LOCAIS, REF);
    const total = r.transferencias.reduce((s, t) => s + t.quantidade, 0);
    expect(total).toBe(2); // A tem 8, protege ceil(0,1×60)=6
    for (const t of r.transferencias) {
      expect(t.quantidade).toBeLessThanOrEqual(t.origem.estoqueDisponivelAntes);
      expect(t.origem.estoqueDisponivelDepois).toBeGreaterThanOrEqual(0);
    }
  });

  it("não deixa a origem com cobertura abaixo da protegida", () => {
    const v = variante("o", [loja("A", 20, 27), loja("B", 0, 27), loja("D", 0, 0)]);
    const r = analisarVariante(v, LOCAIS, REF);
    for (const t of r.transferencias) {
      expect(t.origem.coberturaDepoisDias!).toBeGreaterThanOrEqual(CONFIG_DISTRIBUICAO_PADRAO.coberturaProtegidaOrigemDias);
    }
    // A protege ceil(0,3×60)=18 → só 2 un saem
    expect(r.transferencias.reduce((s, t) => s + t.quantidade, 0)).toBe(2);
  });

  it("depósito sem venda própria pode abastecer loja, mantendo a reserva mínima", () => {
    const v = variante("dep", [loja("A", 0, 30), loja("D", 50, 0)]);
    const r = analisarVariante(v, LOCAIS, REF);
    expect(r.transferencias).toHaveLength(1);
    expect(r.transferencias[0].origem.storeId).toBe("D");
    expect(r.transferencias[0].quantidade).toBe(20); // 30/90×60
    expect(r.transferencias[0].origem.estoqueDisponivelDepois).toBeGreaterThanOrEqual(1);
    expect(r.transferencias[0].limitacoes.join(" ")).toMatch(/depósito/);
  });

  it("estoque em armazenador fora de venda (defeito) nunca é origem de transferência", () => {
    const v = variante("def", [loja("A", 0, 30), loja("X", 100, 0)]);
    const r = analisarVariante(v, LOCAIS, REF);
    expect(r.transferencias).toHaveLength(0);
    expect(r.estoqueForaDeVenda).toBe(100);
  });
});

describe("distribuição de estoque — somente leitura", () => {
  it("o motor não importa Prisma nem o conector DAPIC", () => {
    const src = readFileSync(path.resolve(__dirname, "../distribuicao-estoque.ts"), "utf8");
    expect(src).not.toMatch(/from "@\/lib\/prisma"/);
    expect(src).not.toMatch(/connectors\/dapic/);
  });

  it("a camada de dados não usa nenhum método de escrita nem chama o DAPIC", () => {
    const src = readFileSync(path.resolve(__dirname, "../distribuicao-estoque-dados.ts"), "utf8");
    expect(src).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
    expect(src).not.toMatch(/\$executeRaw/);
    expect(src).not.toMatch(/connectors\/dapic|DapicClient/);
    // as consultas cruas são só SELECT
    const raws = src.match(/\$queryRaw[^`]*`[^`]*`/g) ?? [];
    expect(raws.length).toBeGreaterThan(0);
    for (const q of raws) expect(q).toMatch(/SELECT/);
    expect(raws.join(" ")).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/);
  });
});

describe("distribuição de estoque — busca, filtros e ranking da tela", () => {
  const vs = [
    variante("111", [loja("A", 40, 9), loja("B", 0, 27), loja("C", 6, 9)], { produto: "Classic Blue", cor: "Blue", tamanho: "40" }),
    variante("222", [loja("A", 20, 30), loja("B", 20, 30), loja("C", 20, 30)], { produto: "Jam Sesh Preto", cor: "Preto", tamanho: "M", grupo: "Jam Sesh" }),
    variante("333", [loja("C", 3, 1)], { produto: "Classic Verde", cor: "Verde", tamanho: "42" }),
  ];
  const r = executarAnaliseDistribuicao(entrada(vs));

  it("ranking só ordena: sem filtro devolve o universo inteiro, transferência primeiro", () => {
    const todos = filtrarVariantes(r.variantes, {});
    expect(todos).toHaveLength(r.contagens.variantesProcessadas);
    expect(todos[0].diagnostico).toBe("TRANSFERENCIA_POSSIVEL");
  });

  it("busca por produto, SKU, cor e tamanho (sem acento/maiúscula)", () => {
    expect(filtrarVariantes(r.variantes, { busca: "222" }).map((v) => v.cod)).toEqual(["222"]);
    expect(filtrarVariantes(r.variantes, { busca: "classic 42" }).map((v) => v.cod)).toEqual(["333"]);
    expect(filtrarVariantes(r.variantes, { busca: "PRETO m" }).map((v) => v.cod)).toEqual(["222"]);
  });

  it("filtros por loja, grupo, diagnóstico e confiança", () => {
    expect(filtrarVariantes(r.variantes, { storeId: "A" }).map((v) => v.cod).sort()).toEqual(["111", "222"]);
    expect(filtrarVariantes(r.variantes, { grupo: "Jam Sesh" }).map((v) => v.cod)).toEqual(["222"]);
    expect(filtrarVariantes(r.variantes, { diagnostico: "DADOS_INSUFICIENTES" }).map((v) => v.cod)).toEqual(["333"]);
    expect(filtrarVariantes(r.variantes, { confianca: "BAIXA" }).map((v) => v.cod)).toEqual(["333"]);
  });

  it("restrição de permissão por loja limita variantes e transferências exibidas", () => {
    const soC = filtrarVariantes(r.variantes, { lojasPermitidas: ["C"] });
    expect(soC.map((v) => v.cod).sort()).toEqual(["111", "222", "333"]);
    const ts = filtrarTransferencias(r.transferencias, soC, { lojasPermitidas: ["C"] });
    expect(ts).toHaveLength(0); // a transferência é A → B
    const tsAB = filtrarTransferencias(r.transferencias, r.variantes, { lojasPermitidas: ["B"] });
    expect(tsAB).toHaveLength(1);
  });
});
