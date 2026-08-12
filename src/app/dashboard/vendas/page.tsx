import { getSessionUser } from "@/lib/auth";
import { getSalesByDimension, getSalesByGrupoProduto, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
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

  const [rows, produtoRows, stores, marcas, tabelasPreco] = await Promise.all([
    getSalesByDimension(filters, dimension),
    dimension === "grupo" ? getSalesByGrupoProduto(filters) : Promise.resolve([]),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
  ]);
  const showFinancials = canSeeFinancials(user.role);
  const totalUnits = rows.reduce((sum, r) => sum + r.unitsSold, 0);

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
      <DimensionToggle basePath="/dashboard/vendas" searchParams={rawParams} current={dimension} />

      {dimension === "grupo" ? (
        <ExpandableSalesTable
          rows={rows}
          produtoRows={produtoRows}
          totalUnits={totalUnits}
          showFinancials={showFinancials}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
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
                <tr key={r.key} className="border-b border-[var(--gridline)] last:border-0">
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
    </div>
  );
}
