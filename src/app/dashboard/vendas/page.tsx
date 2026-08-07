import { getSessionUser } from "@/lib/auth";
import { getSalesByDimension, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { canSeeFinancials, getGrupoRestriction } from "@/lib/permissions";
import { parseFilters, parseDimension, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { DimensionToggle } from "../dimension-toggle";

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
  const filters = { ...parseFilters(rawParams), grupoIn };

  const [rows, stores, marcas, tabelasPreco] = await Promise.all([
    getSalesByDimension(filters, dimension),
    getStores(),
    getMarcas(),
    getTabelasPreco(),
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

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">
                {dimension === "grupo" ? "Grupo" : dimension === "produto" ? "Produto" : "Tamanho"}
              </th>
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
    </div>
  );
}
