import { getSessionUser } from "@/lib/auth";
import { getGiftsByDimension, getGiftsByGrupoProduto, getGiftsByCliente, getGiftsByDayByStore, getStores, getMarcas } from "@/lib/metrics";
import { canSeeFinancials, getGrupoRestriction, getStoreRestriction, getMarcaRestriction } from "@/lib/permissions";
import { parseFilters, parseDimension, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { DimensionToggle } from "../dimension-toggle";
import { TopBarChart } from "../top-bar-chart";
import { ExpandableSalesTable } from "../vendas/expandable-sales-table";
import { BrindesTrendChart } from "./brindes-trend-chart";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function BrindesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "brindes");

  const rawParams = await searchParams;
  const dimension = parseDimension(rawParams);
  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const filters = { ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas }), grupoIn };

  const [rows, produtoRows, clienteRows, trendResult, stores, marcas] = await Promise.all([
    getGiftsByDimension(filters, dimension),
    dimension === "grupo" ? getGiftsByGrupoProduto(filters) : Promise.resolve([]),
    getGiftsByCliente(filters),
    getGiftsByDayByStore(filters),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
  ]);
  const showFinancials = canSeeFinancials(user);
  const totalUnits = rows.reduce((sum, r) => sum + r.unitsSold, 0);

  return (
    <div>
      <CollapsibleFilters>
        <FilterBar action="/dashboard/brindes" stores={stores} marcas={marcas} filters={filters} />
      </CollapsibleFilters>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Itens dados como brinde (Tipo=Brinde na API) — não entram na contagem de vendas nem de
        devoluções. Quem retirou é registrado a partir do próximo sync após o deploy de 14/08/2026.
      </p>

      {/* Gráfico de brindes por dia × filial */}
      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Brindes por dia — por filial</h2>
        <BrindesTrendChart data={trendResult.data} stores={trendResult.stores} />
      </section>

      {/* Foco principal: quem retirou */}
      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] mb-6">
        <div className="px-4 py-3 border-b border-[var(--gridline)]">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">Quem retirou brindes</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Unidades</th>
              {showFinancials && <th className="px-4 py-2 font-medium">Valor</th>}
            </tr>
          </thead>
          <tbody>
            {clienteRows.map((r) => (
              <tr key={r.cliente} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                <td className="px-4 py-2 font-medium">{r.cliente}</td>
                <td className="px-4 py-2 tabular-nums">{r.unidades.toLocaleString("pt-BR")}</td>
                {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(r.valor)}</td>}
              </tr>
            ))}
            {clienteRows.length === 0 && (
              <tr>
                <td colSpan={showFinancials ? 3 : 2} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Nenhum dado disponível — aparece após o próximo sync.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Secundário: breakdown por produto */}
      <section className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
          Top {dimension === "grupo" ? "grupo" : dimension === "produto" ? "produto" : "tamanho"} em brinde
        </h2>
        <TopBarChart
          data={rows.slice(0, 10)}
          valueKey={showFinancials ? "revenue" : "unitsSold"}
          showCurrency={showFinancials}
        />
      </section>

      <DimensionToggle basePath="/dashboard/brindes" searchParams={rawParams} current={dimension} />

      {dimension === "grupo" ? (
        <ExpandableSalesTable
          rows={rows}
          produtoRows={produtoRows}
          totalUnits={totalUnits}
          showFinancials={showFinancials}
          emptyMessage="Sem brinde no período/filtro selecionado."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">{dimension === "produto" ? "Produto" : "Tamanho"}</th>
                <th className="px-4 py-2 font-medium">Unidades</th>
                <th className="px-4 py-2 font-medium">% do total</th>
                {showFinancials && <th className="px-4 py-2 font-medium">Valor doado</th>}
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
                    Sem brinde no período/filtro selecionado.
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
