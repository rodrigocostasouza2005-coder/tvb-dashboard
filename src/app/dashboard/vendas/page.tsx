import { getSessionUser } from "@/lib/auth";
import {
  getSalesByDimension,
  getSalesByGrupoProduto,
  getSalesByGrupoProdutoTamanho,
  getSalesByTamanhoProduto,
  getSalesByProdutoTamanho,
  getSalesByDay,
  getSalesByDayPerStore,
  getReturnsByDimension,
  getReturnsByGrupoProduto,
  getReturnsByGrupoProdutoTamanho,
  getReturnsByTamanhoProduto,
  getReturnsByProdutoTamanho,
  getReturnsByDay,
  getStores,
  getMarcas,
  getTabelasPreco,
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
import { ExpandableSalesTable } from "./expandable-sales-table";
import { ExpandableReturnsTable } from "./expandable-returns-table";

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

  const [rows, salesSubRows, salesTamanhoRows, salesByDay, salesByDayPerStore, returnRows, returnSubRows, returnTamanhoRows, returnsByDay, stores, marcas, tabelasPreco, siteCidades, topClientes] = await Promise.all([
    getSalesByDimension(filters, dimension),
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
    canSeeSiteMap ? getSiteVarejoCidades({ ...filters, tabelasPreco: ["Tabela varejo"] }) : Promise.resolve(emptyAtacadoCidades),
    showFinancials ? getTopClientes(filters, null, 5, "todos", true) : Promise.resolve([]),
  ]);
  const totalUnits = rows.reduce((sum, r) => sum + r.unitsSold, 0);
  const totalReturned = returnRows.reduce((sum, r) => sum + r.unitsReturned, 0);
  const top10 = rows.slice(0, 10);

  const siteEstadoMap = new Map<string, { receita: number; unidades: number }>();
  for (const r of siteCidades.rows) {
    const prev = siteEstadoMap.get(r.estado) ?? { receita: 0, unidades: 0 };
    siteEstadoMap.set(r.estado, { receita: prev.receita + r.receita, unidades: prev.unidades + r.unidades });
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

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/vendas"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
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
          <BrazilMap rows={siteEstadoRows} />
        </section>
      )}

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
          Top {dimension === "grupo" ? "grupo" : dimension === "produto" ? "produto" : "tamanho"}{" "}
          {showFinancials ? "por receita bruta" : "por vendas brutas"}
        </h2>
        <TopBarChart data={top10} valueKey={showFinancials ? "revenue" : "unitsSold"} showCurrency={showFinancials} />
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
