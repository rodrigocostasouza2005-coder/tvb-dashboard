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
import { DimensionToggle } from "../dimension-toggle";
import { SalesTrendChart } from "../sales-trend-chart";
import { ReturnsTrendChart } from "../returns-trend-chart";
import { TopBarChart } from "../top-bar-chart";
import { StoreCompareChart } from "../store-compare-chart";
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
  const dimension = parseDimension(rawParams);
  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  const emptySalesSubRows: Awaited<ReturnType<typeof getSalesByGrupoProduto>> = [];
  const emptyReturnSubRows: Awaited<ReturnType<typeof getReturnsByGrupoProduto>> = [];
  const emptyTamanhoSalesRows: Awaited<ReturnType<typeof getSalesByGrupoProdutoTamanho>> = [];
  const emptyTamanhoReturnRows: Awaited<ReturnType<typeof getReturnsByGrupoProdutoTamanho>> = [];

  const [rows, salesSubRows, salesTamanhoRows, salesByDay, salesByDayPerStore, returnRows, returnSubRows, returnTamanhoRows, returnsByDay, stores, marcas, tabelasPreco] = await Promise.all([
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
  ]);
  const showFinancials = canSeeFinancials(user);
  const totalUnits = rows.reduce((sum, r) => sum + r.unitsSold, 0);
  const totalReturned = returnRows.reduce((sum, r) => sum + r.unitsReturned, 0);
  const top10 = rows.slice(0, 10);

  return (
    <div>
      <FilterBar
        action="/dashboard/vendas"
        stores={stores}
        marcas={marcas}
        tabelasPreco={tabelasPreco}
        showTabelaPreco
        filters={filters}
      />

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

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
          Top {dimension === "grupo" ? "grupo" : dimension === "produto" ? "produto" : "tamanho"}{" "}
          {showFinancials ? "por receita" : "por vendas"}
        </h2>
        <TopBarChart data={top10} valueKey={showFinancials ? "revenue" : "unitsSold"} showCurrency={showFinancials} />
      </section>

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
