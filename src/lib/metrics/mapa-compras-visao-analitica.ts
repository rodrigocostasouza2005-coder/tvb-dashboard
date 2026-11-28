import { prisma } from "@/lib/prisma";
import { TipoCompraProduto } from "@prisma/client";
import { COLECAO_BEST_SELLER } from "./reposicao-bestseller-consolidada";

// Visão Analítica do Mapa de Compras (evolução de 2026-11-27, seção 5 do briefing) — análise da
// GRADE de tamanho pro recorte filtrado (grupo/produto/Best Seller/loja/tamanho/período). Grão é
// TAMANHO, não produto — o detalhe por produto já existe na matriz Best Seller/Drop da aba
// Planejamento Mensal (preservada, não duplicada aqui).
//
// Identidade Best Seller/Não via resolverTipoCompraEfetivo (mesma regra de compras-
// inteligencia.ts): classificação manual (ClassificacaoProduto) vence; na ausência,
// colecao === "BESTSELLER" já qualifica. Nunca uma 2ª régua divergente.

export type SituacaoTamanho = "ruptura" | "ajustar" | "equilibrio" | "excesso";

// Limiares documentados (não arbitrários sem explicação, seção 23 do briefing: liberdade criativa
// com decisão registrada) — déficit/excesso são relativos ao estoque IDEAL do próprio tamanho:
//   déficit > 20% do ideal (ou zero estoque com demanda real) -> ruptura
//   déficit entre 5% e 20% -> ajustar
//   excesso > 50% acima do ideal -> excesso
//   caso contrário -> equilíbrio
export function classificarSituacaoTamanho(estoqueAtual: number, estoqueIdeal: number): SituacaoTamanho {
  if (estoqueIdeal <= 0) return estoqueAtual > 0 ? "excesso" : "equilibrio"; // sem demanda calculável, não há "ideal" pra comparar
  const razao = estoqueAtual / estoqueIdeal;
  if (razao <= 0 && estoqueIdeal > 0) return "ruptura";
  if (razao < 0.8) return "ruptura";
  if (razao < 0.95) return "ajustar";
  if (razao > 1.5) return "excesso";
  return "equilibrio";
}

export type LinhaGradeTamanho = {
  tamanho: string;
  vendaHistorica: number; // unidades líquidas de devolução, no período filtrado
  participacaoPct: number; // % do total de vendaHistorica do recorte
  estoqueAtual: number;
  estoqueIdeal: number;
  deficit: number; // max(0, ideal - atual)
  excesso: number; // max(0, atual - ideal)
  compraSugerida: number; // = deficit, exposto também com esse nome pra bater com a linguagem da seção 5.7
  situacao: SituacaoTamanho;
};

export type VisaoAnaliticaFiltro = {
  grupoIn?: string[];
  produto?: string;
  bestSeller?: "todos" | "bs" | "nbs";
  storeIds?: string[]; // já resolvidos (ver getPosicoesEstoque) — não aceita posicaoId composto aqui
  tamanho?: string;
  periodoDias?: number; // default 90
};

export type VisaoAnaliticaKpis = {
  compraSugeridaTotal: number;
  estoqueDisponivel: number;
  estoqueIdeal: number;
  coberturaMediaDias: number | null;
  valorEstimadoCompra: number;
  produtosEmRupturaCount: number; // conta CODS, não tamanhos agregados
};

export type VisaoAnaliticaResultado = {
  kpis: VisaoAnaliticaKpis;
  porTamanho: LinhaGradeTamanho[];
  bestSellerVsNao: { tamanho: string; bestSellerPct: number; naoBestSellerPct: number }[];
  insights: string[];
};

const COBERTURA_PADRAO_MESES = 2; // mesmo default de getMapaDeComprasDetalhado (estoque.ts)
const PERIODO_PADRAO_DIAS = 90;

export async function getVisaoAnaliticaMapaCompras(filtro: VisaoAnaliticaFiltro = {}): Promise<VisaoAnaliticaResultado> {
  const periodoDias = filtro.periodoDias ?? PERIODO_PADRAO_DIAS;
  const desde = new Date(Date.now() - periodoDias * 86_400_000);

  const stockWhere = {
    ...(filtro.storeIds ? { storeId: { in: filtro.storeIds } } : {}),
    ...(filtro.grupoIn ? { grupo: { in: filtro.grupoIn } } : {}),
    ...(filtro.produto ? { produto: filtro.produto } : {}),
    ...(filtro.tamanho ? { tamanho: filtro.tamanho } : {}),
  };

  // Universo de cods no recorte (via StockSnapshot, mesma fonte de identidade cod/produto/grupo/
  // colecao/tamanho usada em toda a Inteligência de Compras/Distribuição).
  const stockRows = await prisma.stockSnapshot.findMany({
    where: stockWhere,
    select: { cod: true, produto: true, grupo: true, tamanho: true, colecao: true, quantidadeDisponivel: true },
  });
  if (stockRows.length === 0) {
    return {
      kpis: { compraSugeridaTotal: 0, estoqueDisponivel: 0, estoqueIdeal: 0, coberturaMediaDias: null, valorEstimadoCompra: 0, produtosEmRupturaCount: 0 },
      porTamanho: [],
      bestSellerVsNao: [],
      insights: ["Nenhum produto encontrado para este recorte de filtros."],
    };
  }

  const cods = [...new Set(stockRows.map((s) => s.cod))];
  const metaPorCod = new Map(stockRows.map((s) => [s.cod, s]));

  const [classificacoesManuais, metasRows, vendasRows, devolucaoRows] = await Promise.all([
    prisma.classificacaoProduto.findMany({ where: { cod: { in: cods } }, select: { cod: true, tipoCompra: true } }),
    prisma.coberturaMeta.findMany(),
    prisma.sale.groupBy({
      by: ["cod", "tamanho"],
      where: { status: { not: "Cancelada" }, cod: { in: cods }, saleDate: { gte: desde } },
      _sum: { quantidade: true },
    }),
    prisma.return.groupBy({
      by: ["cod", "tamanho"],
      where: { status: { not: "Cancelada" }, cod: { in: cods }, returnDate: { gte: desde } },
      _sum: { quantidade: true },
    }),
  ]);

  const tipoCompraManualPorCod = new Map(classificacoesManuais.map((c) => [c.cod, c.tipoCompra]));
  const coberturaMesesPorGrupo = new Map(metasRows.map((m) => [m.grupo, m.mesesCobertura]));

  function resolverTipoCompraEfetivo(cod: string): TipoCompraProduto | null {
    const manual = tipoCompraManualPorCod.get(cod);
    if (manual != null) return manual;
    const meta = metaPorCod.get(cod);
    return meta?.colecao === COLECAO_BEST_SELLER ? TipoCompraProduto.BEST_SELLER : null;
  }

  // Filtro de Best Seller/Não — aplicado nos CODS considerados a partir daqui (vendas, estoque,
  // grade), não no universo de stockRows original (senão o bestSellerVsNao perderia o lado "todos").
  const codsNoFiltroBs = new Set(
    cods.filter((cod) => {
      if ((filtro.bestSeller ?? "todos") === "todos") return true;
      const tipo = resolverTipoCompraEfetivo(cod);
      return filtro.bestSeller === "bs" ? tipo === TipoCompraProduto.BEST_SELLER : tipo !== TipoCompraProduto.BEST_SELLER;
    })
  );

  // Vendas líquidas de devolução por cod::tamanho (achado 1, auditoria 2026-11-26 — Math.max(0,
  // venda - devolução) pela mesma chave/janela, nunca venda bruta).
  function somarChave(rows: { cod: string; tamanho: string | null; _sum: { quantidade: number | null } }[]) {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (!codsNoFiltroBs.has(r.cod)) continue;
      const tamanho = r.tamanho ?? "—";
      m.set(tamanho, (m.get(tamanho) ?? 0) + (r._sum.quantidade ?? 0));
    }
    return m;
  }
  const vendaBrutaPorTamanho = somarChave(vendasRows);
  const devolucaoPorTamanho = somarChave(devolucaoRows);
  const vendaLiquidaPorTamanho = new Map<string, number>();
  for (const [tamanho, v] of vendaBrutaPorTamanho) {
    vendaLiquidaPorTamanho.set(tamanho, Math.max(0, v - (devolucaoPorTamanho.get(tamanho) ?? 0)));
  }

  const estoqueAtualPorTamanho = new Map<string, number>();
  for (const s of stockRows) {
    if (!codsNoFiltroBs.has(s.cod)) continue;
    const tamanho = s.tamanho ?? "—";
    estoqueAtualPorTamanho.set(tamanho, (estoqueAtualPorTamanho.get(tamanho) ?? 0) + s.quantidadeDisponivel);
  }

  // Cobertura alvo: meta do grupo (se o recorte cobrir só 1 grupo, usa o dela; com múltiplos
  // grupos filtrados, usa a média simples das metas presentes — não inventa um número quando não
  // há meta nenhuma, cai no default já usado pelo resto do Mapa de Compras).
  const gruposNoRecorte = [...new Set(stockRows.filter((s) => codsNoFiltroBs.has(s.cod)).map((s) => s.grupo))];
  const coberturaMesesAlvo =
    gruposNoRecorte.length > 0
      ? gruposNoRecorte.reduce((soma, g) => soma + (coberturaMesesPorGrupo.get(g) ?? COBERTURA_PADRAO_MESES), 0) / gruposNoRecorte.length
      : COBERTURA_PADRAO_MESES;

  const totalVendaLiquida = [...vendaLiquidaPorTamanho.values()].reduce((s, v) => s + v, 0);

  const todosTamanhos = new Set<string>([...vendaLiquidaPorTamanho.keys(), ...estoqueAtualPorTamanho.keys()]);
  const porTamanho: LinhaGradeTamanho[] = [...todosTamanhos]
    .map((tamanho) => {
      const vendaHistorica = vendaLiquidaPorTamanho.get(tamanho) ?? 0;
      const estoqueAtual = estoqueAtualPorTamanho.get(tamanho) ?? 0;
      const velocidadeDiaria = vendaHistorica / periodoDias;
      const estoqueIdeal = Math.round(velocidadeDiaria * coberturaMesesAlvo * 30);
      const deficit = Math.max(0, estoqueIdeal - estoqueAtual);
      const excesso = Math.max(0, estoqueAtual - estoqueIdeal);
      return {
        tamanho,
        vendaHistorica,
        participacaoPct: totalVendaLiquida > 0 ? vendaHistorica / totalVendaLiquida : 0,
        estoqueAtual,
        estoqueIdeal,
        deficit,
        excesso,
        compraSugerida: deficit,
        situacao: classificarSituacaoTamanho(estoqueAtual, estoqueIdeal),
      };
    })
    .sort((a, b) => sortTamanhoChave(a.tamanho) - sortTamanhoChave(b.tamanho));

  // Best Seller vs Não — mesma grade de tamanho, mas sempre as 2 curvas lado a lado,
  // independente do filtro de Classificação selecionado (senão sumiria uma das 2 linhas do
  // gráfico quando o usuário filtra só por "Best Seller", por exemplo).
  const codsBs = new Set(cods.filter((c) => resolverTipoCompraEfetivo(c) === TipoCompraProduto.BEST_SELLER));
  function somarPorGrupoBs(rows: { cod: string; tamanho: string | null; _sum: { quantidade: number | null } }[], noGrupo: (cod: string) => boolean) {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (!noGrupo(r.cod)) continue;
      const tamanho = r.tamanho ?? "—";
      m.set(tamanho, (m.get(tamanho) ?? 0) + (r._sum.quantidade ?? 0));
    }
    return m;
  }
  const vendaBsBruta = somarPorGrupoBs(vendasRows, (c) => codsBs.has(c));
  const devolucaoBs = somarPorGrupoBs(devolucaoRows, (c) => codsBs.has(c));
  const vendaNaoBsBruta = somarPorGrupoBs(vendasRows, (c) => !codsBs.has(c));
  const devolucaoNaoBs = somarPorGrupoBs(devolucaoRows, (c) => !codsBs.has(c));
  const liquido = (bruta: Map<string, number>, dev: Map<string, number>, tamanho: string) =>
    Math.max(0, (bruta.get(tamanho) ?? 0) - (dev.get(tamanho) ?? 0));
  const totalBs = [...new Set(vendasRows.map((r) => r.tamanho ?? "—"))].reduce((s, t) => s + liquido(vendaBsBruta, devolucaoBs, t), 0);
  const totalNaoBs = [...new Set(vendasRows.map((r) => r.tamanho ?? "—"))].reduce((s, t) => s + liquido(vendaNaoBsBruta, devolucaoNaoBs, t), 0);
  const bestSellerVsNao = [...todosTamanhos]
    .map((tamanho) => ({
      tamanho,
      bestSellerPct: totalBs > 0 ? liquido(vendaBsBruta, devolucaoBs, tamanho) / totalBs : 0,
      naoBestSellerPct: totalNaoBs > 0 ? liquido(vendaNaoBsBruta, devolucaoNaoBs, tamanho) / totalNaoBs : 0,
    }))
    .sort((a, b) => sortTamanhoChave(a.tamanho) - sortTamanhoChave(b.tamanho));

  // KPIs
  const compraSugeridaTotal = porTamanho.reduce((s, l) => s + l.compraSugerida, 0);
  const estoqueDisponivel = porTamanho.reduce((s, l) => s + l.estoqueAtual, 0);
  const estoqueIdealTotal = porTamanho.reduce((s, l) => s + l.estoqueIdeal, 0);
  const velocidadeDiariaTotal = totalVendaLiquida / periodoDias;
  const coberturaMediaDias = velocidadeDiariaTotal > 0 ? Math.round((estoqueDisponivel / velocidadeDiariaTotal) * 10) / 10 : null;

  // Valor estimado: preço de custo médio não está disponível nesta consulta (StockSnapshot tem
  // valorCusto por loja, nem sempre preenchido) — expõe só quantidade aqui; a aba já tem
  // "Resumo da Compra" (seção 5.7) reaproveitando getRecomendacoesBestSeller/Drop pro valor
  // monetário real (ver visao-analitica-view.tsx), nunca um 2º cálculo divergente de preço.
  const custoMedioRows = await prisma.stockSnapshot.aggregate({
    where: { ...stockWhere, valorCusto: { not: null } },
    _avg: { valorCusto: true },
  });
  const valorEstimadoCompra = compraSugeridaTotal * (custoMedioRows._avg.valorCusto ?? 0);

  const produtosEmRupturaCount = cods.filter((cod) => {
    if (!codsNoFiltroBs.has(cod)) return false;
    const meta = metaPorCod.get(cod);
    if (!meta) return false;
    const tamanho = meta.tamanho ?? "—";
    const linha = porTamanho.find((l) => l.tamanho === tamanho);
    return linha?.situacao === "ruptura";
  }).length;

  const insights = construirInsights({ porTamanho, nomeEscopo: gruposNoRecorte.length === 1 ? gruposNoRecorte[0] : "o catálogo filtrado" });

  return {
    kpis: { compraSugeridaTotal, estoqueDisponivel, estoqueIdeal: estoqueIdealTotal, coberturaMediaDias, valorEstimadoCompra, produtosEmRupturaCount },
    porTamanho,
    bestSellerVsNao,
    insights,
  };
}

// Ordena tamanho numericamente quando possível (30,32,...48), cai pro fim quando não é número
// (ex: "—", "Único", P/M/G).
function sortTamanhoChave(tamanho: string): number {
  const n = Number(tamanho);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

// Insights baseados em regra, só com os números já calculados acima (nunca um texto solto
// desconectado dos KPIs/tabela — seção 5.6 do briefing: "não criar mensagens aleatórias").
export function construirInsights(args: { porTamanho: LinhaGradeTamanho[]; nomeEscopo: string }): string[] {
  const { porTamanho, nomeEscopo } = args;
  if (porTamanho.length === 0) return [];
  const insights: string[] = [];

  const totalVenda = porTamanho.reduce((s, l) => s + l.vendaHistorica, 0);
  const maisRepresentativo = [...porTamanho].sort((a, b) => b.participacaoPct - a.participacaoPct)[0];
  if (totalVenda > 0 && maisRepresentativo.participacaoPct > 0) {
    insights.push(
      `O tamanho ${maisRepresentativo.tamanho} é o mais representativo da demanda de ${nomeEscopo} (${Math.round(maisRepresentativo.participacaoPct * 100)}%).`
    );
  }

  const comExcesso = porTamanho.filter((l) => l.situacao === "excesso").sort((a, b) => b.excesso - a.excesso)[0];
  if (comExcesso) {
    insights.push(`O estoque do tamanho ${comExcesso.tamanho} está ${comExcesso.excesso} unidades acima da necessidade projetada.`);
  }

  const emAjuste = porTamanho.filter((l) => l.situacao === "ajustar" || l.situacao === "ruptura").length;
  if (emAjuste > 0) {
    insights.push(`${emAjuste} tamanho(s) em zona de ruptura/ajuste — vale antecipar a próxima compra.`);
  } else if (porTamanho.length > 0) {
    insights.push("Nenhum tamanho em ruptura/ajuste neste recorte — grade equilibrada.");
  }

  const top3Compra = [...porTamanho]
    .filter((l) => l.compraSugerida > 0)
    .sort((a, b) => b.compraSugerida - a.compraSugerida)
    .slice(0, 3);
  const totalCompra = porTamanho.reduce((s, l) => s + l.compraSugerida, 0);
  if (top3Compra.length > 0 && totalCompra > 0) {
    const pctTop3 = top3Compra.reduce((s, l) => s + l.compraSugerida, 0) / totalCompra;
    insights.push(
      `A compra sugerida está concentrada nos tamanhos ${top3Compra.map((l) => l.tamanho).join(", ")} (${Math.round(pctTop3 * 100)}% do total).`
    );
  }

  return insights;
}
