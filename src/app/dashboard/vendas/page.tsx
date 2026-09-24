import { getSessionUser } from "@/lib/auth";
import {
  getSalesByDimension,
  getSalesByGrupoProduto,
  getSalesByGrupoProdutoTamanho,
  getSalesByTamanhoProduto,
  getSalesByProdutoTamanho,
  getSalesByDay,
  getSalesByDayPerStore,
  getSalesByDayPerColecao,
  getMonthlySalesByGrupo,
  getReturnsByDimension,
  getReturnsByGrupoProduto,
  getReturnsByGrupoProdutoTamanho,
  getReturnsByTamanhoProduto,
  getReturnsByProdutoTamanho,
  getReturnsByDay,
  getStores,
  getMarcas,
  getTabelasPreco,
  getDistinctColecoes,
  getSiteVarejoCidades,
  getTopClientes,
} from "@/lib/metrics";
import {
  canSeeFinancials,
  getGrupoRestriction,
  getStoreRestriction,
  getMarcaRestriction,
  getTabelaPrecoRestriction,
} from "@/lib/permissions";
import { parseFilters, parseDimension, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { DimensionToggle } from "../dimension-toggle";
import { SalesTrendChart } from "../sales-trend-chart";
import { ReturnsTrendChart } from "../returns-trend-chart";
import { TopBarChart } from "../top-bar-chart";
import { StoreCompareChart } from "../store-compare-chart";
import { BrazilMap } from "../brazil-map";
import { IndicatorChart } from "../indicadores/indicator-chart";
import { ExpandableSalesTable } from "./expandable-sales-table";
import { ExpandableReturnsTable } from "./expandable-returns-table";

const FAMILIA_COR = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)", "var(--cat-7)", "var(--cat-8)"];

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function VendasPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "vendas");

  const rawParams = await searchParams;
  const filtrosOpen = rawParams.filtros === "1";
  const dimension = parseDimension(rawParams);
  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };
  const showFinancials = canSeeFinancials(user);
  // "Mapa de vendas" só cobre o canal Site (varejo dentro de Site+Atacado) — é o único canal
  // com cobertura de cidade praticamente completa (lojas físicas só tem ~50%, cliente avulso
  // sem cadastro não tem endereço). Respeita a mesma restrição de tabela de preço do usuário.
  const canSeeSiteMap = showFinancials && allowedTabelasPreco.includes("Tabela varejo");
  const emptyAtacadoCidades: Awaited<ReturnType<typeof getSiteVarejoCidades>> = { rows: [], totalCidades: 0, totalEstados: 0 };

  const emptySalesSubRows: Awaited<ReturnType<typeof getSalesByGrupoProduto>> = [];
  const emptyReturnSubRows: Awaited<ReturnType<typeof getReturnsByGrupoProduto>> = [];
  const emptyTamanhoSalesRows: Awaited<ReturnType<typeof getSalesByGrupoProdutoTamanho>> = [];
  const emptyTamanhoReturnRows: Awaited<ReturnType<typeof getReturnsByGrupoProdutoTamanho>> = [];

  const [rows, salesByColecao, salesByDayPerColecao, porFamilia, salesSubRows, salesTamanhoRows, salesByDay, salesByDayPerStore, returnRows, returnSubRows, returnTamanhoRows, returnsByDay, stores, marcas, tabelasPreco, colecoes, siteCidades, topClientes] = await Promise.all([
    getSalesByDimension(filters, dimension),
    getSalesByDimension(filters, "colecao"),
    getSalesByDayPerColecao(filters),
    getMonthlySalesByGrupo(filters),
    dimension === "grupo"
      ? getSalesByGrupoProduto(filters)
      : dimension === "tamanho"
      ? getSalesByTamanhoProduto(filters)
      : dimension === "produto"
      ? getSalesByProdutoTamanho(filters)
      : Promise.resolve(emptySalesSubRows),
    dimension === "grupo"
      ? getSalesByGrupoProdutoTamanho(filters)
      : Promise.resolve(emptyTamanhoSalesRows),
    getSalesByDay(filters),
    getSalesByDayPerStore(filters),
    getReturnsByDimension(filters, dimension),
    dimension === "grupo"
      ? getReturnsByGrupoProduto(filters)
      : dimension === "tamanho"
      ? getReturnsByTamanhoProduto(filters)
      : dimension === "produto"
      ? getReturnsByProdutoTamanho(filters)
      : Promise.resolve(emptyReturnSubRows),
    dimension === "grupo"
      ? getReturnsByGrupoProdutoTamanho(filters)
      : Promise.resolve(emptyTamanhoReturnRows),
    getReturnsByDay(filters),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getDistinctColecoes(),
    canSeeSiteMap ? getSiteVarejoCidades({ ...filters, tabelasPreco: ["Tabela varejo"] }) : Promise.resolve(emptyAtacadoCidades),
    showFinancials ? getTopClientes(filters, null, 5, "todos", true) : Promise.resolve([]),
  ]);
  const totalUnits = rows.reduce((sum, r) => sum + r.unitsSold, 0);
  const totalReturned = returnRows.reduce((sum, r) => sum + r.unitsReturned, 0);
  const top10 = rows.slice(0, 10);
  const top10Colecao = salesByColecao.slice(0, 10);

  const siteEstadoMap = new Map<string, { receita: number; unidades: number }>();
  const citiesByState = new Map<string, { cidade: string; receita: number; unidades: number }[]>();
  for (const r of siteCidades.rows) {
    const prev = siteEstadoMap.get(r.estado) ?? { receita: 0, unidades: 0 };
    siteEstadoMap.set(r.estado, { receita: prev.receita + r.receita, unidades: prev.unidades + r.unidades });
    const cidades = citiesByState.get(r.estado) ?? [];
    cidades.push({ cidade: r.cidade, receita: r.receita, unidades: r.unidades });
    citiesByState.set(r.estado, cidades);
  }
  const siteEstadoRows = [...siteEstadoMap.entries()].map(([estado, v]) => ({ estado, ...v }));

  function clienteHref(nome: string) {
    const p = new URLSearchParams();
    for (const id of filters.storeIds ?? []) p.append("store", id);
    for (const m of filters.marcas ?? []) p.append("marca", m);
    for (const t of filters.tabelasPreco ?? []) p.append("tabelaPreco", t);
    p.set("cliente", nome);
    return `/dashboard/clientes-ficha?${p.toString()}`;
  }

  // Vendas mensais por Família (grupo): mesmo período/filtro global da página (respeita o
  // filtro de data, diferente das seções "histórico completo" de Análise/Indicadores no Tempo).
  // Seleção de família tipo "Comparar" (top 5 por padrão) — mesmo padrão já usado em Curva de
  // Vida da Coleção.
  const visaoFamilia = rawParams.visaoFamilia === "qtd" ? "qtd" : "faturamento";
  const totalPorFamilia = new Map(
    porFamilia.series.map((f) => [
      f,
      porFamilia.data.reduce((s, d) => s + (visaoFamilia === "qtd" ? (d.units[f] ?? 0) : (d.revenue[f] ?? 0)), 0),
    ])
  );
  const top5Familias = [...porFamilia.series].sort((a, b) => (totalPorFamilia.get(b) ?? 0) - (totalPorFamilia.get(a) ?? 0)).slice(0, 5);
  const familiaParam = rawParams.familia;
  const familiaSelecionadaParam = Array.isArray(familiaParam) ? familiaParam : typeof familiaParam === "string" ? [familiaParam] : undefined;
  const familiasSelecionadas = (familiaSelecionadaParam ?? top5Familias).filter((f) => porFamilia.series.includes(f));

  // Reconstrói a partir de TODOS os rawParams (não só dos campos de DashboardFilters) — mesma
  // técnica do DimensionToggle (buildHref em dimension-toggle.tsx) — senão perderia o filtro de
  // data (from/to) dessa página ao trocar a visão Faturamento/Quantidade.
  function familiaQueryBase() {
    const p = new URLSearchParams();
    for (const [key, value] of Object.entries(rawParams)) {
      if (key === "familia" || key === "visaoFamilia" || value === undefined) continue;
      if (Array.isArray(value)) value.forEach((v) => p.append(key, v));
      else p.append(key, value);
    }
    return p;
  }

  function visaoFamiliaHref(v: "faturamento" | "qtd") {
    const p = familiaQueryBase();
    for (const f of familiasSelecionadas) p.append("familia", f);
    p.set("visaoFamilia", v);
    return `/dashboard/vendas?${p.toString()}#familia`;
  }

  const chartDataFamilia = porFamilia.data.map((d) => {
    const point: Record<string, string | number> = { month: d.month };
    for (const f of familiasSelecionadas) point[f] = (visaoFamilia === "qtd" ? d.units[f] : d.revenue[f]) ?? 0;
    return point;
  });

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/vendas"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          colecoes={colecoes}
          showTabelaPreco
          filters={filters}
        />
      </CollapsibleFilters>

      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Vendas ao longo do período</h2>
          <SalesTrendChart data={salesByDay} showRevenue={showFinancials} />
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Comparativo entre lojas</h2>
          <StoreCompareChart data={salesByDayPerStore.data} series={salesByDayPerStore.series} />
        </div>
      </section>

      {canSeeSiteMap && siteEstadoRows.length > 0 && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Mapa de vendas — Site</h2>
          <p className="mb-3 text-xs text-[var(--text-muted)]">
            Só o canal varejo do site (endereço de entrega). Lojas físicas não entram — a maior parte da venda avulsa não tem cidade cadastrada.
          </p>
          <BrazilMap rows={siteEstadoRows} citiesByState={citiesByState} />
        </section>
      )}

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
          Top {dimension === "grupo" ? "grupo" : dimension === "produto" ? "produto" : "tamanho"}{" "}
          {showFinancials ? "por receita bruta" : "por vendas brutas"}
        </h2>
        <TopBarChart data={top10} valueKey={showFinancials ? "revenue" : "unitsSold"} showCurrency={showFinancials} />
      </section>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Comparativo por coleção (unidades líquidas)</h2>
        <StoreCompareChart data={salesByDayPerColecao.data} series={salesByDayPerColecao.series} />
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
          Ranking por coleção (total do período) {showFinancials ? "(receita bruta)" : "(unidades brutas)"}
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
            <TopBarChart
              data={top10Colecao}
              valueKey={showFinancials ? "revenue" : "unitsSold"}
              showCurrency={showFinancials}
            />
          </div>
          <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                  <th className="px-4 py-2 font-medium">Coleção</th>
                  <th className="px-4 py-2 font-medium">Unidades brutas</th>
                  {showFinancials && <th className="px-4 py-2 font-medium">Receita bruta</th>}
                </tr>
              </thead>
              <tbody>
                {top10Colecao.map((c) => (
                  <tr key={c.key} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                    <td className="px-4 py-2 font-medium">{c.key}</td>
                    <td className="px-4 py-2 tabular-nums">{c.unitsSold.toLocaleString("pt-BR")}</td>
                    {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(c.revenue)}</td>}
                  </tr>
                ))}
                {top10Colecao.length === 0 && (
                  <tr>
                    <td colSpan={showFinancials ? 3 : 2} className="px-4 py-6 text-center text-[var(--text-muted)]">
                      Sem vendas no período/filtro selecionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="familia" className="mb-6">
        <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Vendas mensais por família</h2>
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          Evolução mês a mês por família de produto (mesmo filtro de período/loja/marca desta página) — pra
          identificar crescimento, queda ou concentração de vendas numa família.
        </p>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
          <form method="GET" action="/dashboard/vendas#familia" className="flex flex-wrap items-center gap-2">
            {[...familiaQueryBase().entries()]
              .filter(([key]) => key !== "familia")
              .map(([key, value], i) => (
                <input key={`${key}-${i}`} type="hidden" name={key} value={value} />
              ))}
            {porFamilia.series.map((f) => (
              <label key={f} className="cursor-pointer">
                <input type="checkbox" name="familia" value={f} defaultChecked={familiasSelecionadas.includes(f)} className="peer sr-only" />
                <span className="inline-block rounded-full border border-[var(--border)] bg-[var(--page-plane)] px-3 py-1 text-xs text-[var(--text-secondary)] transition-colors peer-checked:border-[var(--series-1)] peer-checked:bg-[var(--series-1)] peer-checked:text-white">
                  {f}
                </span>
              </label>
            ))}
            <button type="submit" className="rounded-md bg-[var(--series-1)] px-3 py-1.5 text-xs font-medium text-white">
              Comparar
            </button>
          </form>

          <div className="flex overflow-hidden rounded-md border border-[var(--border)] text-xs">
            <a
              href={visaoFamiliaHref("faturamento")}
              className={`px-3 py-1.5 ${visaoFamilia === "faturamento" ? "bg-[var(--series-1)] text-white" : "text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"}`}
            >
              Faturamento
            </a>
            <a
              href={visaoFamiliaHref("qtd")}
              className={`px-3 py-1.5 ${visaoFamilia === "qtd" ? "bg-[var(--series-1)] text-white" : "text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"}`}
            >
              Quantidade
            </a>
          </div>
        </div>

        {familiasSelecionadas.length > 0 && chartDataFamilia.length > 0 ? (
          <>
            <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <IndicatorChart
                data={chartDataFamilia}
                format={visaoFamilia === "qtd" ? "number" : "currency"}
                series={familiasSelecionadas.map((f, i) => ({ key: f, name: f, color: FAMILIA_COR[i % FAMILIA_COR.length] }))}
              />
            </div>

            <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                    <th className="px-4 py-2 font-medium">Família</th>
                    {porFamilia.data.map((d) => (
                      <th key={d.month} className="px-4 py-2 text-right font-medium">{d.month}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {familiasSelecionadas.map((f) => (
                    <tr key={f} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                      <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{f}</td>
                      {porFamilia.data.map((d) => {
                        const v = (visaoFamilia === "qtd" ? d.units[f] : d.revenue[f]) ?? 0;
                        return (
                          <td key={d.month} className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                            {v > 0
                              ? visaoFamilia === "qtd"
                                ? v.toLocaleString("pt-BR")
                                : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
                              : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">Sem família com vendas suficientes no filtro selecionado.</p>
        )}
      </section>

      {showFinancials && topClientes.length > 0 && (
        <section className="mb-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="border-b border-[var(--gridline)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)]">Top 5 clientes</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Cliente</th>
                <th className="px-4 py-2 font-medium">Receita líquida</th>
                <th className="px-4 py-2 font-medium">Pedidos</th>
              </tr>
            </thead>
            <tbody>
              {topClientes.map((c, i) => (
                <tr key={c.cliente} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 tabular-nums text-[var(--text-muted)]">{i + 1}</td>
                  <td className="px-4 py-2 font-medium">
                    <a href={clienteHref(c.cliente)} className="hover:underline">{c.cliente}</a>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{formatBRL(c.receitaLiquida)}</td>
                  <td className="px-4 py-2 tabular-nums">{c.pedidos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <DimensionToggle basePath="/dashboard/vendas" searchParams={rawParams} current={dimension} />

      <ExpandableSalesTable
        rows={rows}
        produtoRows={salesSubRows}
        tamanhoRows={salesTamanhoRows}
        totalUnits={totalUnits}
        showFinancials={showFinancials}
        parentLabel={dimension === "tamanho" ? "Tamanho" : dimension === "produto" ? "Produto" : "Grupo"}
        subLabel={dimension === "produto" ? "Tamanho" : "Produto"}
      />
      {/* ── Devoluções ── */}
      <h2 className="mb-3 mt-8 text-base font-semibold">Devoluções</h2>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Devoluções ao longo do período</h3>
        <ReturnsTrendChart data={returnsByDay} showValue={showFinancials} />
      </section>

      <ExpandableReturnsTable
        rows={returnRows}
        subRows={returnSubRows}
        tamanhoRows={returnTamanhoRows}
        totalReturned={totalReturned}
        showFinancials={showFinancials}
        parentLabel={dimension === "tamanho" ? "Tamanho" : dimension === "produto" ? "Produto" : "Grupo"}
      />
    </div>
  );
}
