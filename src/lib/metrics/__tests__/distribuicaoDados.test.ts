import { describe, it, expect, vi } from "vitest";

// Prisma "armadilha": qualquer método de escrita (ou $executeRaw) lança erro e fica registrado.
// Prova em execução — não só lendo o código-fonte — que a análise de distribuição só lê.
const chamadas: string[] = [];
const ESCRITA = /^(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$transaction)$/;

const DIA = 86_400_000;
const agora = Date.now();

const leituras: Record<string, Record<string, (...a: unknown[]) => unknown>> = {
  store: {
    findMany: () => [
      { id: "LEB", name: "TVB Leblon", sellsProducts: true },
      { id: "BAR", name: "TVB Barra", sellsProducts: true },
      { id: "PA", name: "Produtos acabados", sellsProducts: true },
      { id: "DEF", name: "Defeito Leblon", sellsProducts: false },
    ],
  },
  stockSnapshot: {
    findMany: () => [
      { storeId: "LEB", cod: "1", produto: "Classic Blue", grupo: "Classic Lisa", cor: "Blue", tamanho: "40", colecao: null, quantidadeDisponivel: 0, valorCusto: 59 },
      { storeId: "BAR", cod: "1", produto: "Classic Blue", grupo: "Classic Lisa", cor: "Blue", tamanho: "40", colecao: null, quantidadeDisponivel: 2, valorCusto: 59 },
      { storeId: "PA", cod: "1", produto: "Classic Blue", grupo: "Classic Lisa", cor: "Blue", tamanho: "40", colecao: null, quantidadeDisponivel: 40, valorCusto: 59 },
      { storeId: "DEF", cod: "1", produto: "Classic Blue", grupo: "Classic Lisa", cor: "Blue", tamanho: "40", colecao: null, quantidadeDisponivel: 7, valorCusto: 59 },
      // variante que nunca vendeu, sem idade conhecida
      { storeId: "PA", cod: "2", produto: "Classic Blue", grupo: "Classic Lisa", cor: "Blue", tamanho: "50", colecao: null, quantidadeDisponivel: 3, valorCusto: 59 },
      // insumo
      { storeId: "PA", cod: "3", produto: "Etiqueta", grupo: "(sem grupo)", cor: null, tamanho: null, colecao: null, quantidadeDisponivel: 900, valorCusto: 0.1 },
    ],
  },
  gift: { groupBy: () => [] },
  sale: {
    groupBy: (args: unknown) => {
      const a = args as { by: string[]; _max?: unknown; _min?: unknown };
      if (a._max) return [{ storeId: "LEB", cod: "1", _max: { saleDate: new Date(agora - 2 * DIA) } }];
      return [{ cod: "1", _min: { saleDate: new Date(agora - 400 * DIA) } }];
    },
  },
  productionOrder: { groupBy: () => [] },
  classificacaoProduto: { findMany: () => [] },
  priceCatalogCache: { findMany: () => [{ data: { "1": [], "4": [] } }, { data: { "4": [] } }] },
  syncLog: {
    findFirst: (args: unknown) => {
      const a = args as { where: { source: string } };
      return { finishedAt: new Date(a.where.source === "STOCK" ? "2026-10-29T03:35:18Z" : "2026-10-29T03:30:00Z") };
    },
  },
};

function queryRaw(strings: TemplateStringsArray) {
  const sql = strings.join("?");
  chamadas.push(`$queryRaw:${sql.includes('FROM "Sale"') ? "Sale" : "Return"}`);
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/.test(sql)) throw new Error("SQL de escrita");
  if (sql.includes('FROM "Sale"')) {
    // Leblon vendeu 27 (zerada agora), Barra vendeu 9 nos últimos 90 dias
    return Promise.resolve([
      { storeId: "LEB", cod: "1", produto: "Classic Blue", grupo: "Classic Lisa", cor: "Blue", tamanho: "40", colecao: null, vendas30: 9, vendas60: 18, vendas90: 27, brindes90: 0, canceladas90: 2, ultimaVendaJanela: new Date(agora - 2 * DIA) },
      { storeId: "BAR", cod: "1", produto: "Classic Blue", grupo: "Classic Lisa", cor: "Blue", tamanho: "40", colecao: null, vendas30: 3, vendas60: 6, vendas90: 9, brindes90: 0, canceladas90: 0, ultimaVendaJanela: new Date(agora - 5 * DIA) },
    ]);
  }
  return Promise.resolve([{ storeId: "BAR", cod: "1", devolucoes30: 1, devolucoes60: 1, devolucoes90: 1 }]);
}

vi.mock("@/lib/prisma", () => {
  const modelo = (nome: string) =>
    new Proxy(
      {},
      {
        get(_t, metodo: string) {
          return (...args: unknown[]) => {
            chamadas.push(`${nome}.${metodo}`);
            if (ESCRITA.test(metodo)) throw new Error(`escrita proibida: ${nome}.${metodo}`);
            const fn = leituras[nome]?.[metodo];
            if (!fn) throw new Error(`leitura não mockada: ${nome}.${metodo}`);
            return Promise.resolve(fn(...args));
          };
        },
      }
    );
  return {
    prisma: new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "$queryRaw") return queryRaw;
          if (prop.startsWith("$")) {
            return () => {
              chamadas.push(prop);
              throw new Error(`proibido: ${prop}`);
            };
          }
          return modelo(prop);
        },
      }
    ),
  };
});

describe("getAnaliseDistribuicaoEstoque (dados reais montados, somente leitura)", () => {
  it("analisa o universo inteiro a partir do banco sincronizado, sem nenhuma escrita", async () => {
    const { getAnaliseDistribuicaoEstoque } = await import("../distribuicao-estoque-dados");
    const r = await getAnaliseDistribuicaoEstoque();

    expect(chamadas.some((c) => ESCRITA.test(c.split(".")[1] ?? c))).toBe(false);
    expect(r.somenteLeitura).toBe(true);
    expect(r.execucao.status).toBe("COMPLETA");
    expect(r.execucao.versaoDados).toBe("estoque:2026-10-29T03:35:18.000Z|vendas:2026-10-29T03:30:00.000Z");

    // universo = estoque (1, 2, 3) + catálogo de preços (4, sem duplicar "1")
    expect(r.contagens.variantesUnicas).toBe(4);
    expect(r.contagens.reconciliado).toBe(true);
    expect(r.contagens.locaisAnalisados).toBe(3); // Leblon, Barra, Produtos acabados (Defeito excluído)
    expect(r.contagens.combinacoesProcessadas).toBe(12);
    expect(r.linhasEstoque).toBe(6);

    const papeis = Object.fromEntries(r.locais.map((l) => [l.storeId, l.papel]));
    expect(papeis).toEqual({ LEB: "PONTO_VENDA", BAR: "PONTO_VENDA", PA: "DEPOSITO", DEF: "EXCLUIDO" });

    const v1 = r.variantes.find((v) => v.cod === "1")!;
    expect(v1.estoqueForaDeVenda).toBe(7);
    expect(v1.vendasLiquidas90).toBe(27 + 9 - 1);
    // Leblon zerada vendendo 0,3/dia → recebe do depósito Produtos acabados
    expect(v1.diagnostico).toBe("TRANSFERENCIA_POSSIVEL");
    const t = v1.transferencias.find((x) => x.destino.storeId === "LEB")!;
    expect(t.origem.storeId).toBe("PA");
    expect(t.quantidade).toBe(18);

    expect(r.variantes.find((v) => v.cod === "2")!.diagnostico).toBe("DADOS_INSUFICIENTES");
    expect(r.variantes.find((v) => v.cod === "3")!.diagnostico).toBe("NAO_APLICAVEL");
    expect(r.variantes.find((v) => v.cod === "4")!.diagnostico).toBe("SEM_ESTOQUE_SEM_DEMANDA");
  });
});
