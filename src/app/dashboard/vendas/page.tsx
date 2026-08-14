import { getSessionUser } from "@/lib/auth";
import {
  getSalesByDimension,
  getSalesByGrupoProduto,
  getSalesByDay,
  getSalesByDayPerStore,
  getReturnsByDimension,
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

  const [rows, produtoRows, salesByDay, salesByDayPerStore, returnRows, returnsByDay, stores, marcas, tabelasPreco] = await Promise.all([
    getSalesByDimension(filters, dimension),
    dimension === "grupo" ? getSalesByGrupoProduto(filters) : Promise.resolve([]),
    getSalesByDay(filters),
    getSalesByDayPerStore(filters),
    getReturnsByDimension(filters, dimension),
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

      {dimension === "grupo" ? (
        <ExpandableSalesTable
          rows={rows}
          produtoRows={produtoRows}
          totalUnits={totalUnits}
          showFinancials={showFinancials}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">{dimension === "produto" ? "Produto" : "Tamanho"}</th>
                <th className="px-4 py-2 font-medium">Unidades</th>
                <th className="px-4 py-2 font-medium">% do total</th>
                {showFinancials && <th className="px-4 py-2 font-medium">Receita</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium">{r.key}</td>
                  <td className="px-4 py-2 tabular-nums">{r.unitsSold.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
                    {totalUnits > 0 ? `${((r.unitsSold / totalUnits) * 100).toFixed(1)}%` : "—"}
                  </td>
                  {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(r.revenue)}</td>}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={showFinancials ? 4 : 3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Sem vendas no período/filtro selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {/* ── Devoluções ── */}
      <h2 className="mb-3 mt-8 text-base font-semibold">Devoluções</h2>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Devoluções ao longo do período</h3>
        <ReturnsTrendChart data={returnsByDay} showValue={showFinancials} />
      </section>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">{dimension === "grupo" ? "Grupo" : dimension === "produto" ? "Produto" : "Tamanho"}</th>
              <th className="px-4 py-2 font-medium">Unidades devolvidas</th>
              <th className="px-4 py-2 font-medium">% do total devolvido</th>
              {showFinancials && <th className="px-4 py-2 font-medium">Valor devolvido</th>}
            </tr>
          </thead>
          <tbody>
            {returnRows.map((r) => (
              <tr key={r.key} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                <td className="px-4 py-2 font-medium">{r.key}</td>
                <td className="px-4 py-2 tabular-nums">{r.unitsReturned.toLocaleString("pt-BR")}</td>
                <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
                  {totalReturned > 0 ? `${((r.unitsReturned / totalReturned) * 100).toFixed(1)}%` : "—"}
                </td>
                {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(r.value)}</td>}
              </tr>
            ))}
            {returnRows.length === 0 && (
              <tr>
                <td colSpan={showFinancials ? 4 : 3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Sem devoluções no período/filtro selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
