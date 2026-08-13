import { getSessionUser } from "@/lib/auth";
import { getVendedorRanking, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { canSeeFinancials, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { MetricBarChart } from "../metric-bar-chart";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function VendedoresPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "vendedores");

  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = parseFilters(await searchParams, {
    allowedStoreIds: allowedStores,
    allowedMarcas,
    allowedTabelasPreco,
  });
  const [rows, stores, marcas, tabelasPreco] = await Promise.all([
    getVendedorRanking(filters),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
  ]);
  const showFinancials = canSeeFinancials(user);

  // Uma seção por loja (não uma lista só misturando todo mundo) — cada loja com seu próprio
  // ranking. Ordem das lojas por receita total, do mesmo jeito que os vendedores já eram
  // ordenados dentro de cada uma (getVendedorRanking já devolve tudo ordenado por receita).
  const byStore = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byStore.get(r.storeName) ?? [];
    list.push(r);
    byStore.set(r.storeName, list);
  }
  const stores2 = [...byStore.entries()].sort(
    ([, a], [, b]) => b.reduce((s, r) => s + r.receita, 0) - a.reduce((s, r) => s + r.receita, 0)
  );

  return (
    <div>
      <FilterBar
        action="/dashboard/vendedores"
        stores={stores}
        marcas={marcas}
        tabelasPreco={tabelasPreco}
        showTabelaPreco
        filters={filters}
      />

      <div className="flex flex-col gap-6">
        {stores2.map(([storeName, storeRows]) => (
          <section key={storeName}>
            <h2 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">{storeName}</h2>
            <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
              <MetricBarChart
                data={storeRows
                  .slice(0, 10)
                  .map((r) => ({ key: r.vendedor, value: showFinancials ? r.receita : r.unidades }))}
                format={showFinancials ? "currency" : "number"}
                color="var(--cat-4)"
              />
            </div>
            <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                    <th className="px-4 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">Vendedor</th>
                    <th className="px-4 py-2 font-medium">Vendas</th>
                    <th className="px-4 py-2 font-medium">Unidades</th>
                    {showFinancials && <th className="px-4 py-2 font-medium">Receita</th>}
                  </tr>
                </thead>
                <tbody>
                  {storeRows.map((r, i) => (
                    <tr key={r.vendedor} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                      <td className="px-4 py-2 text-[var(--text-muted)]">{i + 1}</td>
                      <td className="px-4 py-2 font-medium">{r.vendedor}</td>
                      <td className="px-4 py-2 tabular-nums">{r.pedidos}</td>
                      <td className="px-4 py-2 tabular-nums">{r.unidades.toLocaleString("pt-BR")}</td>
                      {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(r.receita)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {rows.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
            Sem vendas com vendedor identificado no período/filtro selecionado.
          </p>
        )}
      </div>
    </div>
  );
}
