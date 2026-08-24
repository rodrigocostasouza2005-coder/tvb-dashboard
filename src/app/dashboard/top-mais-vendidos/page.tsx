import { getSessionUser } from "@/lib/auth";
import { getSalesByGrupoProduto, getReturnsByGrupoProduto, netByReturns, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { canSeeFinancials, getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { MetricBarChart } from "../metric-bar-chart";

const LIMIT = 10;

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function TopMaisVendidosPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "top-mais-vendidos");

  const rawParams = await searchParams;
  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  const [allRowsBrutas, returns, stores, marcas, tabelasPreco] = await Promise.all([
    getSalesByGrupoProduto(filters),
    getReturnsByGrupoProduto(filters),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
  ]);
  // Líquido (desconta devolução) — pedido do Rodrigo em 2026-08-24. Reordena depois de
  // descontar, já que a devolução pode mudar quem é "mais vendido" de verdade.
  const allRows = netByReturns(allRowsBrutas, returns).sort((a, b) => b.revenue - a.revenue);

  const showFinancials = canSeeFinancials(user);
  const top = allRows.slice(0, LIMIT);

  return (
    <div>
      <FilterBar
        action="/dashboard/top-mais-vendidos"
        stores={stores}
        marcas={marcas}
        tabelasPreco={tabelasPreco}
        showTabelaPreco
        filters={filters}
      />

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
          Top {LIMIT} produtos {showFinancials ? "por receita líquida" : "por unidades líquidas"}
        </h2>
        <MetricBarChart
          data={top.map((r) => ({ key: r.key, value: showFinancials ? r.revenue : r.unitsSold }))}
          format={showFinancials ? "currency" : "number"}
          color="var(--series-1)"
        />
      </section>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-4 py-2 font-medium">Grupo</th>
              <th className="px-4 py-2 font-medium">Produto</th>
              <th className="px-4 py-2 font-medium text-right">Unidades líquidas</th>
              {showFinancials && <th className="px-4 py-2 font-medium text-right">Receita líquida</th>}
            </tr>
          </thead>
          <tbody>
            {top.map((r, i) => (
              <tr key={r.key} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                <td className="px-4 py-2 tabular-nums text-[var(--text-muted)]">{i + 1}</td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{r.grupo}</td>
                <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{r.key}</td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                  {r.unitsSold.toLocaleString("pt-BR")}
                </td>
                {showFinancials && (
                  <td className="px-4 py-2 tabular-nums text-right text-[var(--text-primary)]">
                    {formatBRL(r.revenue)}
                  </td>
                )}
              </tr>
            ))}
            {top.length === 0 && (
              <tr>
                <td colSpan={showFinancials ? 5 : 4} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Sem vendas no período selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
