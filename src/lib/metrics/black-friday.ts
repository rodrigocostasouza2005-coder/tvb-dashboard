// Central Black Friday (missão 2026-11-05) — agrega dado que já existe em outros módulos
// (core/vendas/cac/compras-inteligencia + connectors/meta-ads) numa visão só, sem reimplementar
// nenhuma regra de negócio que já existe em outro lugar (ver saleWhere/returnWhere em core.ts,
// getCacEcommerce em cac.ts, getClassificacaoPorProduto em compras-inteligencia.ts).
//
// Regra inegociável desta tela (ver prompt da missão): canal nunca é somado escondendo a
// origem — Site(CD)/Leblon/Rio Sul/Barra/Atacado aparecem SEMPRE separados, por Store.code real,
// nunca por displayGroup (que hoje agrupa CD+ATACADO só pra exibição no FilterBar).
import { prisma } from "@/lib/prisma";
import { saleWhere, returnWhere, netByReturns, type DashboardFilters } from "./core";
import { getSalesByGrupoProduto, getReturnsByGrupoProduto } from "./vendas";
import { getClassificacaoPorProduto } from "./compras-inteligencia";
import { getInsightsPorConjunto } from "@/lib/connectors/meta-ads";
import { todayBrasiliaStr } from "@/lib/filters";

// ===== Visão geral =====

export type ResumoBlackFriday = {
  from: Date;
  to: Date;
  faturamento: number; // líquido (já descontada devolução)
  pedidos: number; // nº de dapicVendaId distintos no período
  pecas: number; // unidades líquidas
  ticketMedio: number | null;
  investimentoMidia: number;
  investimentoIndisponivel: boolean;
  // Receita total da empresa / investimento total em mídia — métrica "blended" (não é ROAS por
  // canal: o Meta Ads hoje roda majoritariamente pro site, mas essa função soma TODA a receita,
  // de qualquer loja, no denominador contra TODO o gasto). Exibir sempre junto da ressalva de
  // que não é um ROAS por canal/campanha (esse existe só por conjunto/anúncio, ver connectors).
  roas: number | null;
};

export async function getResumoBlackFriday(filters: DashboardFilters): Promise<ResumoBlackFriday> {
  const where = saleWhere(filters);
  const [salesAgg, pedidosRows, returnsAgg, investimentoResult] = await Promise.all([
    prisma.sale.aggregate({ where, _sum: { quantidade: true, valorTotalLiquido: true } }),
    prisma.sale.groupBy({ by: ["storeId", "dapicVendaId"], where }),
    prisma.return.aggregate({ where: returnWhere(filters), _sum: { quantidade: true, valorTotal: true } }),
    getInsightsPorConjunto({ since: todayBrasiliaStr(filters.from), until: todayBrasiliaStr(filters.to) }).then(
      (insights) => {
        let total = 0;
        for (const i of insights.values()) total += i.gasto;
        return { valor: total, indisponivel: false };
      },
      () => ({ valor: 0, indisponivel: true })
    ),
  ]);

  const faturamento = (salesAgg._sum.valorTotalLiquido ?? 0) - (returnsAgg._sum.valorTotal ?? 0);
  const pecas = (salesAgg._sum.quantidade ?? 0) - (returnsAgg._sum.quantidade ?? 0);
  const pedidos = pedidosRows.length;

  return {
    from: filters.from,
    to: filters.to,
    faturamento,
    pedidos,
    pecas,
    ticketMedio: pedidos > 0 ? faturamento / pedidos : null,
    investimentoMidia: investimentoResult.valor,
    investimentoIndisponivel: investimentoResult.indisponivel,
    roas: !investimentoResult.indisponivel && investimentoResult.valor > 0 ? faturamento / investimentoResult.valor : null,
  };
}

// Janela imediatamente anterior, mesma duração em dias — usado pra "comparativo com período
// anterior" (item 1 da missão). Quem chama decide se mostra a comparação ou não (só deve mostrar
// quando os dois períodos tiverem pedido/faturamento real — ver condição na página).
export function periodoAnterior(from: Date, to: Date): { from: Date; to: Date } {
  const duracaoMs = to.getTime() - from.getTime();
  return {
    from: new Date(from.getTime() - duracaoMs - 1),
    to: new Date(from.getTime() - 1),
  };
}

// ===== Por canal (Store.code real, nunca displayGroup) =====

export type CanalVendasRow = {
  storeId: string;
  code: string;
  nome: string;
  unitsSold: number;
  revenue: number;
  pedidos: number;
  ticketMedio: number | null;
};

// Ordem fixa de exibição pedida na missão — qualquer loja fora dessa lista (ex: armazém novo)
// aparece depois, em ordem alfabética, nunca escondida.
const ORDEM_CANAL = ["CD", "Leblon", "Rio Sul", "Barra", "ATACADO"];

function nomeCanal(code: string, nome: string): string {
  if (code === "CD") return "Site (CD)";
  return nome;
}

// Função PURA (sem Prisma) — monta a linha por canal a partir de somas já agregadas por
// storeId. Separada pra ser testável sem banco: ver __tests__/blackFriday.test.ts.
export function montarVendasPorCanal(
  stores: { id: string; code: string; name: string }[],
  salesSum: { storeId: string; units: number; revenue: number }[],
  returnsSum: { storeId: string; units: number; value: number }[],
  pedidosPorStore: Map<string, number>
): CanalVendasRow[] {
  const salesByStore = new Map(salesSum.map((s) => [s.storeId, s]));
  const returnsByStore = new Map(returnsSum.map((r) => [r.storeId, r]));

  const rows: CanalVendasRow[] = stores.map((s) => {
    const sold = salesByStore.get(s.id) ?? { units: 0, revenue: 0 };
    const returned = returnsByStore.get(s.id) ?? { units: 0, value: 0 };
    const unitsSold = sold.units - returned.units;
    const revenue = sold.revenue - returned.value;
    const pedidos = pedidosPorStore.get(s.id) ?? 0;
    return {
      storeId: s.id,
      code: s.code,
      nome: nomeCanal(s.code, s.name),
      unitsSold,
      revenue,
      pedidos,
      ticketMedio: pedidos > 0 ? revenue / pedidos : null,
    };
  });

  return rows.sort((a, b) => {
    const ia = ORDEM_CANAL.indexOf(a.code);
    const ib = ORDEM_CANAL.indexOf(b.code);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.nome.localeCompare(b.nome);
  });
}

export async function getVendasPorCanal(filters: DashboardFilters): Promise<CanalVendasRow[]> {
  const where = saleWhere(filters);
  const [stores, salesRows, returnRows, pedidosRows] = await Promise.all([
    prisma.store.findMany({ where: { sellsProducts: true }, select: { id: true, code: true, name: true } }),
    prisma.sale.groupBy({ by: ["storeId"], where, _sum: { quantidade: true, valorTotalLiquido: true } }),
    prisma.return.groupBy({ by: ["storeId"], where: returnWhere(filters), _sum: { quantidade: true, valorTotal: true } }),
    prisma.sale.groupBy({ by: ["storeId", "dapicVendaId"], where }),
  ]);

  const pedidosPorStore = new Map<string, number>();
  for (const p of pedidosRows) {
    pedidosPorStore.set(p.storeId, (pedidosPorStore.get(p.storeId) ?? 0) + 1);
  }

  return montarVendasPorCanal(
    stores,
    salesRows.map((r) => ({ storeId: r.storeId, units: r._sum.quantidade ?? 0, revenue: r._sum.valorTotalLiquido ?? 0 })),
    returnRows.map((r) => ({ storeId: r.storeId, units: r._sum.quantidade ?? 0, value: r._sum.valorTotal ?? 0 })),
    pedidosPorStore
  );
}

// ===== Produtos (reaproveita a inteligência de compras já existente) =====

export type ProdutoBlackFriday = {
  grupo: string;
  produto: string;
  unitsSold: number;
  revenue: number;
  classificacao: "BEST_SELLER" | "DROP" | "SEM_CLASSIFICACAO";
  divergente: boolean;
};

export async function getTopProdutosBlackFriday(filters: DashboardFilters, limit = 20): Promise<ProdutoBlackFriday[]> {
  const [vendas, devolucoes, classificacoes] = await Promise.all([
    getSalesByGrupoProduto(filters),
    getReturnsByGrupoProduto(filters),
    getClassificacaoPorProduto(),
  ]);
  const liquido = netByReturns(vendas, devolucoes);

  return liquido
    .map((v) => {
      const entry = classificacoes.get(`${v.grupo}::${v.key}`);
      return {
        grupo: v.grupo,
        produto: v.key,
        unitsSold: v.unitsSold,
        revenue: v.revenue,
        classificacao: entry?.tipoCompra ?? "SEM_CLASSIFICACAO",
        divergente: entry?.divergente ?? false,
      } satisfies ProdutoBlackFriday;
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}
