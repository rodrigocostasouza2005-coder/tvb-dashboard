import { getSessionUser } from "@/lib/auth";
import { getStores, getMarcas, getTabelasPreco, getDistinctColecoes, type DashboardFilters } from "@/lib/metrics";
import { canSeeFinancials, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction, getGrupoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { StatTile } from "../stat-tile";
import { IndicatorChart } from "../indicadores/indicator-chart";
import { formatBRL, formatBRLCompact, formatNumber, formatPercent } from "@/lib/format";
import { ReceitaCmvBarChart, MargemBarChart, EficienciaScatterChart } from "../custo-familia/custo-familia-charts";
import { CustoFamiliaTable } from "../custo-familia/custo-familia-table";
import { buildCustoFamiliaViewModel } from "../custo-familia/build-view-model";

// Mesma análise de "Custo por Família" (receita/CMV/margem/sell-through por família), mas
// sempre canal b2b — página própria dentro de Atacado em vez de um seletor de canal na página
// geral (pedido explícito do Rodrigo em 2026-10-06: "eu queria um que estivesse dentro do
// atacado, e não que pudesse escolher"). A lógica de cálculo é 100% compartilhada via
// buildCustoFamiliaViewModel — zero duplicação de regra de negócio entre as duas páginas.
export default async function AtacadoCustoFamiliaPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "atacado-custo-familia");

  const rawParams = await searchParams;
  const filtrosOpen = rawParams.filtros === "1";
  const showFinancials = canSeeFinancials(user);

  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  // Restrição COMPLETA (inclui "Tabela atacado") — diferente da maioria das páginas do Radar
  // de propósito, porque esta é a própria área dedicada de atacado.
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);

  const parsedFilters = parseFilters(rawParams, { allowedStoreIds: allowedStores });
  const selectedStoreIds = parsedFilters.storeIds ?? allowedStores;

  const [stores, marcas, tabelasPreco, colecoes] = await Promise.all([
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getDistinctColecoes(),
  ]);

  const filters: DashboardFilters = {
    storeIds: selectedStoreIds,
    marcas: allowedMarcas,
    tabelasPreco: allowedTabelasPreco,
    colecaoIn: parsedFilters.colecaoIn,
    grupoIn,
    from: parsedFilters.from,
    to: parsedFilters.to,
  };

  if (!showFinancials) {
    return (
      <div>
        <h1 className="mb-1 text-lg font-semibold text-[var(--text-primary)]">Custo por Família — Atacado</h1>
        <p className="mb-6 text-sm text-[var(--text-muted)]">Receita, custo, margem e eficiência de cada família, só vendas de atacado (B2B).</p>
        <CollapsibleFilters defaultOpen={filtrosOpen}>
          <FilterBar
            action="/dashboard/atacado-custo-familia"
            stores={stores}
            marcas={marcas}
            tabelasPreco={tabelasPreco}
            colecoes={colecoes}
            showTabelaPreco
            filters={filters}
          />
        </CollapsibleFilters>
        <p className="text-sm text-[var(--text-muted)]">Você não tem permissão para ver dados financeiros (receita, custo, margem).</p>
      </div>
    );
  }

  const vm = await buildCustoFamiliaViewModel(filters, "b2b");

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-[var(--text-primary)]">Custo por Família — Atacado</h1>
      <p className="mb-6 text-sm text-[var(--text-muted)]">Receita, custo, margem e eficiência de cada família, só vendas de atacado (B2B).</p>

      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/atacado-custo-familia"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          colecoes={colecoes}
          showTabelaPreco
          filters={filters}
        />
      </CollapsibleFilters>

      <p className="mb-4 text-xs text-[var(--text-muted)]">
        CMV estimado: aplica o custo unitário ATUAL de cada SKU (StockSnapshot) às unidades vendidas do período — o Radar não guarda o custo histórico de quando cada venda aconteceu, só o custo de hoje. Não é CMV contábil. Receita/CMV não descontam devolução (mesma regra já usada em Indicadores/Atacado — Return não tem como ser atribuída a um canal com confiança).
        {vm.totalUnidadesSemCusto > 0 && ` ${formatNumber(vm.totalUnidadesSemCusto)} unidade(s) vendida(s) no período não têm custo conhecido e não entraram no CMV.`}
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Receita (atacado)" value={formatBRLCompact(vm.totalReceita)} />
        <StatTile label="CMV estimado" value={formatBRLCompact(vm.totalCmv)} />
        <StatTile label="Lucro bruto" value={formatBRLCompact(vm.totalLucro)} />
        <StatTile label="Margem bruta" value={vm.margemTotalPct === null ? "—" : formatPercent(vm.margemTotalPct)} />
        <StatTile label="Unidades vendidas" value={formatNumber(vm.totalUnidades)} />
        <StatTile label="Estoque a custo" value={formatBRLCompact(vm.totalEstoqueCusto)} />
      </div>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Receita x CMV por Família (atacado)</h2>
        <ReceitaCmvBarChart data={vm.barData} />
      </section>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Margem bruta por Família (atacado)</h2>
        <MargemBarChart data={vm.margemBarData} />
      </section>

      {vm.evolucaoSeries.length > 0 && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Evolução da Margem (atacado)</h2>
          <IndicatorChart data={vm.evolucaoMargemData} format="percent" series={vm.evolucaoSeries} />
        </section>
      )}

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Eficiência das Famílias (atacado)</h2>
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          Linhas pontilhadas = média do período (sell-through {formatPercent(vm.sellThroughMedio)}, margem {formatPercent(vm.margemMedia)}). Tamanho do ponto = receita.
        </p>
        <EficienciaScatterChart data={vm.eficienciaData} margemMedia={vm.margemMedia} sellThroughMedio={vm.sellThroughMedio} />
      </section>

      {vm.insights.length > 0 && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Insights</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {vm.insights.map((insight, i) => (
              <li key={i} className="rounded-md border border-[var(--border)] bg-[var(--page-plane)] p-3">
                <div className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{insight.titulo}</div>
                <div className="text-xs text-[var(--text-secondary)]">{insight.texto}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Ranking de Rentabilidade (atacado)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Família</th>
                <th className="px-3 py-2 text-right font-medium">Margem bruta</th>
                <th className="px-3 py-2 text-right font-medium">Margem %</th>
                <th className="px-3 py-2 text-right font-medium">Receita</th>
              </tr>
            </thead>
            <tbody>
              {vm.ranking.map((r, i) => (
                <tr key={r.familia} className="border-b border-[var(--gridline)] last:border-0">
                  <td className="px-3 py-2 tabular-nums text-[var(--text-muted)]">{i + 1}</td>
                  <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{r.familia}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums font-semibold text-[var(--text-primary)]">{formatBRL(r.lucroBruto)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums font-medium text-[var(--text-secondary)]">{r.margemPct === null ? "—" : formatPercent(r.margemPct)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums text-[var(--text-secondary)]">{formatBRL(r.receitaLiquida)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Visão Geral por Família (atacado)</h2>
        <CustoFamiliaTable rows={vm.rows} />
      </section>
    </div>
  );
}
