import { getSessionUser } from "@/lib/auth";
import {
  getSalesByDimension,
  getReturnsByDimension,
  netByReturns,
  getStockVsSales,
  getEstoqueAtual,
  getCmvPorGrupo,
  getCmvMensalPorGrupo,
  getMonthlySalesByGrupo,
  getStores,
  getMarcas,
  getTabelasPreco,
  getDistinctColecoes,
  type DashboardFilters,
} from "@/lib/metrics";
import { canSeeFinancials, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestrictionSemAtacado, getGrupoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { StatTile } from "../stat-tile";
import { IndicatorChart } from "../indicadores/indicator-chart";
import { formatBRL, formatNumber, formatPercent } from "@/lib/format";
import { ReceitaCmvBarChart, MargemBarChart, EficienciaScatterChart } from "./custo-familia-charts";
import { CustoFamiliaTable, type FamiliaRow } from "./custo-familia-table";

// Mesmo limite de séries já usado em FamiliaProdutoSection (vendas/família) — a paleta
// categórica (--cat-1..--cat-8) tem 8 cores, mais que isso o gráfico de evolução vira sopa.
const MAX_SERIES_EVOLUCAO = 8;
const CAT_COLORS = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)", "var(--cat-7)", "var(--cat-8)"];

// "Alta/baixa" margem e sell-through são relativos à MÉDIA das famílias no período/filtro atual,
// não um limiar fixo inventado (ex: "margem >= 40%") — isso mudaria de produto pra produto e não
// temos base pra documentar um número "oficial". Comparar contra a média é transparente,
// reproduzível e se ajusta automaticamente ao período/filtro escolhido. Mesmas 4 categorias
// pedidas pelo Rodrigo.
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

export default async function CustoFamiliaPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "custo-familia");

  const rawParams = await searchParams;
  const filtrosOpen = rawParams.filtros === "1";
  const showFinancials = canSeeFinancials(user);

  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestrictionSemAtacado(user);

  const parsedFilters = parseFilters(rawParams, { allowedStoreIds: allowedStores });
  const selectedStoreIds = parsedFilters.storeIds ?? allowedStores;

  const [stores, marcas, tabelasPreco, colecoes] = await Promise.all([
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getDistinctColecoes(),
  ]);

  // Toda a página é sobre custo/margem — sem permissão financeira não há conteúdo parcial
  // significativo pra mostrar (diferente de outras abas, onde unidades/volume continuam úteis
  // sem o lado R$). Mesmo filtro (FilterBar) continua disponível pra não confundir navegação.
  if (!showFinancials) {
    return (
      <div>
        <h1 className="mb-1 text-lg font-semibold text-[var(--text-primary)]">Custo por Família</h1>
        <p className="mb-6 text-sm text-[var(--text-muted)]">Entenda receita, custo, margem e eficiência de cada família.</p>
        <CollapsibleFilters defaultOpen={filtrosOpen}>
          <FilterBar
            action="/dashboard/custo-familia"
            stores={stores}
            marcas={marcas}
            tabelasPreco={tabelasPreco}
            colecoes={colecoes}
            showTabelaPreco
            filters={{ storeIds: selectedStoreIds, marcas: allowedMarcas, tabelasPreco: allowedTabelasPreco, colecaoIn: parsedFilters.colecaoIn, grupoIn, from: parsedFilters.from, to: parsedFilters.to }}
          />
        </CollapsibleFilters>
        <p className="text-sm text-[var(--text-muted)]">Você não tem permissão para ver dados financeiros (receita, custo, margem).</p>
      </div>
    );
  }

  const filters: DashboardFilters = {
    storeIds: selectedStoreIds,
    marcas: allowedMarcas,
    tabelasPreco: allowedTabelasPreco,
    colecaoIn: parsedFilters.colecaoIn,
    grupoIn,
    from: parsedFilters.from,
    to: parsedFilters.to,
  };

  const [salesByGrupo, returnsByGrupo, cmvByGrupo, stockVsSales, estoqueAtual] = await Promise.all([
    getSalesByDimension(filters, "grupo"),
    getReturnsByDimension(filters, "grupo"),
    getCmvPorGrupo(filters),
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
    // null = não aplicável (sem receita líquida pra dividir), não é 0 — família com receita
    // líquida de R$0 de verdade (ex: só devolução no período) é um caso diferente de "não dá
    // pra calcular margem", mas como ambos levam a null aqui, a tabela mostra "—" nos dois (não
    // existe divisão por zero escondida; receita 0 e sem-receita convergem pro mesmo "—" porque
    // margem % não tem sentido sem receita de qualquer forma).
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

  const barData = rows.map((r) => ({ familia: r.familia, receitaLiquida: r.receitaLiquida, cmv: r.cmv }));
  const margemBarData = rows.map((r) => ({ familia: r.familia, margemPct: r.margemPct }));
  const eficienciaData = rows
    .filter((r): r is FamiliaRow & { margemPct: number; sellThrough: number } => r.margemPct !== null && r.sellThrough !== null)
    .map((r) => ({ familia: r.familia, sellThrough: r.sellThrough, margemPct: r.margemPct, receitaLiquida: r.receitaLiquida }));

  // Evolução de margem: só as famílias de maior receita no período (ver MAX_SERIES_EVOLUCAO) —
  // mesma aproximação "bruta por mês" documentada em getCmvMensalPorGrupo.
  const topFamilias = rows.filter((r) => r.receitaLiquida > 0).slice(0, MAX_SERIES_EVOLUCAO).map((r) => r.familia);
  const [monthlyRevenue, monthlyCmv] = await Promise.all([
    getMonthlySalesByGrupo(filters),
    getCmvMensalPorGrupo(filters, topFamilias),
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
  const insights: string[] = [];
  if (comVenda.length > 0) {
    const melhor = [...comVenda].sort((a, b) => b.margemPct! - a.margemPct!)[0];
    if (melhor.margemPct! >= margemMedia && (melhor.sellThrough ?? 0) >= sellThroughMedio) {
      insights.push(
        `${melhor.familia} tem a maior margem do período (${formatPercent(melhor.margemPct!)}) e sell-through de ${formatPercent(melhor.sellThrough ?? 0)}, acima da média — família eficiente.`
      );
    }
    const maiorReceitaMargemBaixa = [...comVenda]
      .filter((r) => r.margemPct! < margemMedia)
      .sort((a, b) => b.receitaLiquida - a.receitaLiquida)[0];
    if (maiorReceitaMargemBaixa) {
      insights.push(
        `${maiorReceitaMargemBaixa.familia} tem o maior faturamento entre as famílias com margem abaixo da média (${formatBRL(maiorReceitaMargemBaixa.receitaLiquida)}, margem de ${formatPercent(maiorReceitaMargemBaixa.margemPct!)} vs média de ${formatPercent(margemMedia)}).`
      );
    }
    const margemAltaEstoqueAlto = [...comVenda]
      .filter((r) => r.margemPct! >= margemMedia && (r.sellThrough ?? 100) < sellThroughMedio)
      .sort((a, b) => b.valorEstoqueCusto - a.valorEstoqueCusto)[0];
    if (margemAltaEstoqueAlto) {
      insights.push(
        `${margemAltaEstoqueAlto.familia} tem margem boa (${formatPercent(margemAltaEstoqueAlto.margemPct!)}), mas ${formatBRL(margemAltaEstoqueAlto.valorEstoqueCusto)} em estoque a custo com sell-through de ${formatPercent(margemAltaEstoqueAlto.sellThrough ?? 0)} — capital parado.`
      );
    }
    const prioridade = [...comVenda]
      .filter((r) => r.status.label === "Prioridade de revisão")
      .sort((a, b) => b.receitaLiquida - a.receitaLiquida)[0];
    if (prioridade) {
      insights.push(
        `${prioridade.familia} tem margem de ${formatPercent(prioridade.margemPct!)} e sell-through de ${formatPercent(prioridade.sellThrough ?? 0)}, ambos abaixo da média — prioridade de revisão.`
      );
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-[var(--text-primary)]">Custo por Família</h1>
      <p className="mb-6 text-sm text-[var(--text-muted)]">Entenda receita, custo, margem e eficiência de cada família.</p>

      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/custo-familia"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          colecoes={colecoes}
          showTabelaPreco
          filters={filters}
        />
      </CollapsibleFilters>

      <p className="mb-4 text-xs text-[var(--text-muted)]">
        CMV estimado: aplica o custo unitário ATUAL de cada SKU (StockSnapshot) às unidades vendidas líquidas do período — o Radar não guarda o custo histórico de quando cada venda aconteceu, só o custo de hoje. Não é CMV contábil.
        {totalUnidadesSemCusto > 0 && ` ${formatNumber(totalUnidadesSemCusto)} unidade(s) vendida(s) no período não têm custo conhecido e não entraram no CMV.`}
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Receita líquida" value={formatBRL(totalReceita)} />
        <StatTile label="CMV estimado" value={formatBRL(totalCmv)} />
        <StatTile label="Lucro bruto" value={formatBRL(totalLucro)} />
        <StatTile label="Margem bruta" value={margemTotalPct === null ? "—" : formatPercent(margemTotalPct)} />
        <StatTile label="Unidades vendidas" value={formatNumber(totalUnidades)} />
        <StatTile label="Estoque a custo" value={formatBRL(totalEstoqueCusto)} />
      </div>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Receita x CMV por Família</h2>
        <ReceitaCmvBarChart data={barData} />
      </section>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Margem bruta por Família</h2>
        <MargemBarChart data={margemBarData} />
      </section>

      {evolucaoSeries.length > 0 && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Evolução da Margem ({evolucaoSeries.length === MAX_SERIES_EVOLUCAO ? `top ${MAX_SERIES_EVOLUCAO}` : "famílias com venda"})</h2>
          <IndicatorChart data={evolucaoMargemData} format="percent" series={evolucaoSeries} />
        </section>
      )}

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Eficiência das Famílias</h2>
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          Linhas pontilhadas = média do período (sell-through {formatPercent(sellThroughMedio)}, margem {formatPercent(margemMedia)}). Tamanho do ponto = receita líquida.
        </p>
        <EficienciaScatterChart data={eficienciaData} margemMedia={margemMedia} sellThroughMedio={sellThroughMedio} />
      </section>

      {insights.length > 0 && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Insights</h2>
          <ul className="flex flex-col gap-2 text-sm text-[var(--text-secondary)]">
            {insights.map((texto, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="text-[var(--series-1)]">•</span>
                {texto}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Ranking de Rentabilidade</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Família</th>
                <th className="px-3 py-2 font-medium">Margem bruta</th>
                <th className="px-3 py-2 font-medium">Margem %</th>
                <th className="px-3 py-2 font-medium">Receita líquida</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r, i) => (
                <tr key={r.familia} className="border-b border-[var(--gridline)] last:border-0">
                  <td className="px-3 py-2 tabular-nums text-[var(--text-muted)]">{i + 1}</td>
                  <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{r.familia}</td>
                  <td className="px-3 py-2 tabular-nums font-medium text-[var(--text-primary)]">{formatBRL(r.lucroBruto)}</td>
                  <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{r.margemPct === null ? "—" : formatPercent(r.margemPct)}</td>
                  <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{formatBRL(r.receitaLiquida)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Visão Geral por Família</h2>
        <CustoFamiliaTable rows={rows} />
      </section>
    </div>
  );
}
