import { getSessionUser } from "@/lib/auth";
import { getStockVsSales, getStores, getMarcas } from "@/lib/metrics";
import { getGrupoRestriction } from "@/lib/permissions";
import { parseFilters, parseDimension, type RawSearchParams } from "@/lib/filters";
import { FilterBar } from "../filter-bar";
import { DimensionToggle } from "../dimension-toggle";

function statusFor(rate: number | null): { label: string; color: string } {
  if (rate === null) return { label: "—", color: "var(--text-muted)" };
  if (rate >= 50) return { label: "Bom", color: "var(--status-good)" };
  if (rate >= 30) return { label: "Atenção", color: "var(--status-warning)" };
  return { label: "Crítico", color: "var(--status-critical)" };
}

export default async function SellthroughPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;

  const rawParams = await searchParams;
  const dimension = parseDimension(rawParams);
  const grupoIn = await getGrupoRestriction(user.role);
  const filters = { ...parseFilters(rawParams), grupoIn };

  const [rows, stores, marcas] = await Promise.all([
    getStockVsSales(filters, dimension),
    getStores(),
    getMarcas(),
  ]);
  const sorted = [...rows].sort((a, b) => (b.sellThroughRate ?? -1) - (a.sellThroughRate ?? -1));

  return (
    <div>
      <FilterBar action="/dashboard/sellthrough" stores={stores} marcas={marcas} filters={filters} />
      <DimensionToggle basePath="/dashboard/sellthrough" searchParams={rawParams} current={dimension} />
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Sell-through = vendido / (vendido + estoque atual). Giro = vendido / estoque atual (aproximação
        até termos série histórica de estoque via sync automático).
      </p>
      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">
                {dimension === "grupo" ? "Grupo" : dimension === "produto" ? "Produto" : "Tamanho"}
              </th>
              <th className="px-4 py-2 font-medium">Sell-through</th>
              <th className="px-4 py-2 font-medium">Giro</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const status = statusFor(r.sellThroughRate);
              return (
                <tr key={r.key} className="border-b border-[var(--gridline)] last:border-0">
                  <td className="px-4 py-2 font-medium">{r.key}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {r.sellThroughRate !== null ? `${r.sellThroughRate.toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-4 py-2 tabular-nums">
                    {r.inventoryTurnover !== null ? r.inventoryTurnover.toFixed(2) : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: status.color }} />
                      {status.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Sem dados para o período/filtro selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
