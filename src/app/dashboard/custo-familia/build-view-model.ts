import {
  getSalesByDimension,
  getReturnsByDimension,
  netByReturns,
  getStockVsSales,
  getEstoqueAtual,
  getCmvPorGrupo,
  getCmvMensalPorGrupo,
  getMonthlySalesByGrupo,
  type DashboardFilters,
  type Canal,
} from "@/lib/metrics";
import { formatBRL, formatPercent } from "@/lib/format";
import type { FamiliaRow } from "./custo-familia-table";

// Mesmo limite de séries já usado em FamiliaProdutoSection (vendas/família) — a paleta
// categórica (--cat-1..--cat-8) tem 8 cores, mais que isso o gráfico de evolução vira sopa.
const MAX_SERIES_EVOLUCAO = 8;
const CAT_COLORS = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)", "var(--cat-7)", "var(--cat-8)"];

// "Alta/baixa" margem e sell-through são relativos à MÉDIA das famílias no período/filtro atual,
// não um limiar fixo inventado (ex: "margem >= 40%") — isso mudaria de produto pra produto e não
// temos base pra documentar um número "oficial". Comparar contra a média é transparente,
// reproduzível e se ajusta automaticamente ao período/filtro escolhido.
function statusFamilia(
  margemPct: number | null,
  sellThrough: number | null,
  margemMedia: number,
  sellThroughMedio: number
): { label: string; color: string } {
  if (margemPct === null || sellThrough === null) return { label: "Sem dados", color: "var(--text-muted)" };
  const margemAlta = margemPct >= margemMedia;
  const sellThroughAlto = sellThrough >= sellThroughMedio;
  if (margemAlta && sellThroughAlto) return { label: "Eficiente", color: "var(--status-good)" };
  if (margemAlta && !sellThroughAlto) return { label: "Atenção ao estoque", color: "var(--status-warning)" };
  if (!margemAlta && sellThroughAlto) return { label: "Revisar custo/preço", color: "var(--status-warning)" };
  return { label: "Prioridade de revisão", color: "var(--status-critical)" };
}

// Lógica compartilhada entre "Custo por Família" (geral, varejo) e "Atacado → Custo por
// Família" (sempre canal b2b) — extraído pra não duplicar a mesma regra de negócio em duas
// páginas. canal === "b2b": devolução não entra (bruta = líquida), mesma regra já documentada
// em getMonthlySnapshotKpi/getAtacadoVendas (Return não tem como ser atribuída a um canal com
// confiança).
export async function buildCustoFamiliaViewModel(filters: DashboardFilters, canal: Canal = "todos") {
  const [salesByGrupo, returnsByGrupo, cmvByGrupo, stockVsSales, estoqueAtual] = await Promise.all([
    getSalesByDimension(filters, "grupo", canal),
    canal === "b2b" ? Promise.resolve([] as Awaited<ReturnType<typeof getReturnsByDimension>>) : getReturnsByDimension(filters, "grupo"),
    getCmvPorGrupo(filters, canal),
    getStockVsSales(filters, "grupo"),
    getEstoqueAtual({ storeIds: filters.storeIds, grupoIn: filters.grupoIn }, "grupo"),
  ]);

  // Receita/unidades líquidas: MESMA função (netByReturns) usada em todo o resto do Radar pra
  // "venda menos devolução" — nenhuma regra nova, só aplicada por família em vez de por produto.
  const netSales = netByReturns(salesByGrupo, returnsByGrupo);
  const netSalesByKey = new Map(netSales.map((s) => [s.key, s]));
  const cmvByKey = new Map(cmvByGrupo.map((c) => [c.key, c]));
  const estoqueByKey = new Map(estoqueAtual.map((e) => [e.key, e]));
  const sellThroughByKey = new Map(stockVsSales.map((s) => [s.key, s.sellThroughRate]));

  const allKeys = new Set<string>([...netSalesByKey.keys(), ...cmvByKey.keys(), ...estoqueByKey.keys()]);

  const rowsSemStatus = [...allKeys].map((familia) => {
    const sale = netSalesByKey.get(familia);
    const receitaLiquida = sale?.revenue ?? 0;
    const unidadesLiquidas = sale?.unitsSold ?? 0;
    const cmvInfo = cmvByKey.get(familia);
    const cmv = cmvInfo?.cmv ?? 0;
    const unidadesSemCusto = cmvInfo?.unidadesSemCusto ?? 0;
    const lucroBruto = receitaLiquida - cmv;
    // null = não aplicável (sem receita líquida pra dividir), não é 0.
    const margemPct = receitaLiquida > 0 ? (lucroBruto / receitaLiquida) * 100 : null;
    const custoPorPeca = unidadesLiquidas > 0 ? cmv / unidadesLiquidas : null;
    const precoMedio = unidadesLiquidas > 0 ? receitaLiquida / unidadesLiquidas : null;
    const estoque = estoqueByKey.get(familia);
    const sellThrough = sellThroughByKey.get(familia) ?? null;
    return {
      familia,
      receitaLiquida,
      cmv,
      lucroBruto,
      margemPct,
      unidadesLiquidas,
      estoqueAtual: estoque?.quantidade ?? 0,
      valorEstoqueCusto: estoque?.valorCusto ?? 0,
      custoPorPeca,
      precoMedio,
      sellThrough,
      unidadesSemCusto,
    };
  });

  const margens = rowsSemStatus.map((r) => r.margemPct).filter((v): v is number => v !== null);
  const sellThroughs = rowsSemStatus.map((r) => r.sellThrough).filter((v): v is number => v !== null);
  const margemMedia = margens.length > 0 ? margens.reduce((s, v) => s + v, 0) / margens.length : 0;
  const sellThroughMedio = sellThroughs.length > 0 ? sellThroughs.reduce((s, v) => s + v, 0) / sellThroughs.length : 0;

  const rows: FamiliaRow[] = rowsSemStatus
    .map((r) => ({ ...r, status: statusFamilia(r.margemPct, r.sellThrough, margemMedia, sellThroughMedio) }))
    .sort((a, b) => b.receitaLiquida - a.receitaLiquida);

  const totalReceita = rows.reduce((s, r) => s + r.receitaLiquida, 0);
  const totalCmv = rows.reduce((s, r) => s + r.cmv, 0);
  const totalLucro = totalReceita - totalCmv;
  const margemTotalPct = totalReceita > 0 ? (totalLucro / totalReceita) * 100 : null;
  const totalUnidades = rows.reduce((s, r) => s + r.unidadesLiquidas, 0);
  const totalEstoqueCusto = rows.reduce((s, r) => s + r.valorEstoqueCusto, 0);
  const totalUnidadesSemCusto = rows.reduce((s, r) => s + r.unidadesSemCusto, 0);

  const barData = rows.map((r) => ({ familia: r.familia, receitaLiquida: r.receitaLiquida, cmv: r.cmv, lucroBruto: r.lucroBruto, margemPct: r.margemPct }));
  const margemBarData = rows.map((r) => ({ familia: r.familia, margemPct: r.margemPct }));
  const eficienciaData = rows
    .filter((r): r is FamiliaRow & { margemPct: number; sellThrough: number } => r.margemPct !== null && r.sellThrough !== null)
    .map((r) => ({ familia: r.familia, sellThrough: r.sellThrough, margemPct: r.margemPct, receitaLiquida: r.receitaLiquida, cmv: r.cmv }));

  // Evolução de margem: só as famílias de maior receita no período (ver MAX_SERIES_EVOLUCAO) —
  // mesma aproximação "bruta por mês" documentada em getCmvMensalPorGrupo.
  const topFamilias = rows.filter((r) => r.receitaLiquida > 0).slice(0, MAX_SERIES_EVOLUCAO).map((r) => r.familia);
  const [monthlyRevenue, monthlyCmv] = await Promise.all([
    getMonthlySalesByGrupo(filters, canal),
    getCmvMensalPorGrupo(filters, topFamilias, canal),
  ]);
  const cmvMensalMap = new Map(monthlyCmv.map((c) => [`${c.month}\x00${c.grupo}`, c.cmv]));
  const evolucaoMargemData = monthlyRevenue.data.map((d) => {
    const row: Record<string, string | number | null> = { month: d.month };
    for (const familia of topFamilias) {
      const revenue = d.revenue[familia] ?? 0;
      const cmvMes = cmvMensalMap.get(`${d.month}\x00${familia}`) ?? 0;
      row[familia] = revenue > 0 ? ((revenue - cmvMes) / revenue) * 100 : null;
    }
    return row;
  });
  const evolucaoSeries = topFamilias.map((familia, i) => ({ key: familia, name: familia, color: CAT_COLORS[i % CAT_COLORS.length] }));

  const ranking = [...rows].filter((r) => r.receitaLiquida > 0).sort((a, b) => b.lucroBruto - a.lucroBruto).slice(0, 10);

  // Insights: só regras determinísticas sobre os números já calculados acima — nenhum texto
  // genérico, cada frase só aparece se a condição bater com dado real do período/filtro atual.
  const comVenda = rows.filter((r) => r.receitaLiquida > 0 && r.margemPct !== null);
  const insights: { titulo: string; texto: string }[] = [];
  if (comVenda.length > 0) {
    const melhor = [...comVenda].sort((a, b) => b.margemPct! - a.margemPct!)[0];
    if (melhor.margemPct! >= margemMedia && (melhor.sellThrough ?? 0) >= sellThroughMedio) {
      insights.push({
        titulo: `${melhor.familia} — família eficiente`,
        texto: `Maior margem do período (${formatPercent(melhor.margemPct!)}) e sell-through de ${formatPercent(melhor.sellThrough ?? 0)}, ambos acima da média.`,
      });
    }
    const maiorReceitaMargemBaixa = [...comVenda]
      .filter((r) => r.margemPct! < margemMedia)
      .sort((a, b) => b.receitaLiquida - a.receitaLiquida)[0];
    if (maiorReceitaMargemBaixa) {
      insights.push({
        titulo: `${maiorReceitaMargemBaixa.familia} — margem abaixo da média`,
        texto: `Maior faturamento entre as famílias com margem abaixo da média (${formatBRL(maiorReceitaMargemBaixa.receitaLiquida)}, margem de ${formatPercent(maiorReceitaMargemBaixa.margemPct!)} vs média de ${formatPercent(margemMedia)}).`,
      });
    }
    const margemAltaEstoqueAlto = [...comVenda]
      .filter((r) => r.margemPct! >= margemMedia && (r.sellThrough ?? 100) < sellThroughMedio)
      .sort((a, b) => b.valorEstoqueCusto - a.valorEstoqueCusto)[0];
    if (margemAltaEstoqueAlto) {
      insights.push({
        titulo: `${margemAltaEstoqueAlto.familia} — estoque parado`,
        texto: `Margem boa (${formatPercent(margemAltaEstoqueAlto.margemPct!)}), mas ${formatBRL(margemAltaEstoqueAlto.valorEstoqueCusto)} em estoque a custo com sell-through de ${formatPercent(margemAltaEstoqueAlto.sellThrough ?? 0)}.`,
      });
    }
    const prioridade = [...comVenda]
      .filter((r) => r.status.label === "Prioridade de revisão")
      .sort((a, b) => b.receitaLiquida - a.receitaLiquida)[0];
    if (prioridade) {
      insights.push({
        titulo: `${prioridade.familia} — prioridade de revisão`,
        texto: `Margem de ${formatPercent(prioridade.margemPct!)} e sell-through de ${formatPercent(prioridade.sellThrough ?? 0)}, ambos abaixo da média.`,
      });
    }
  }

  return {
    rows,
    totalReceita,
    totalCmv,
    totalLucro,
    margemTotalPct,
    totalUnidades,
    totalEstoqueCusto,
    totalUnidadesSemCusto,
    barData,
    margemBarData,
    eficienciaData,
    evolucaoMargemData,
    evolucaoSeries,
    ranking,
    insights,
    margemMedia,
    sellThroughMedio,
  };
}
