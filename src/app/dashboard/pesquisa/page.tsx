import { getSessionUser } from "@/lib/auth";
import { searchStockVsSalesComTamanhos, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";

function statusFor(rate: number | null): { label: string; color: string } {
  if (rate === null) return { label: "—", color: "var(--text-muted)" };
  if (rate >= 50) return { label: "Bom", color: "var(--status-good)" };
  if (rate >= 30) return { label: "Atenção", color: "var(--status-warning)" };
  return { label: "Crítico", color: "var(--status-critical)" };
}

export default async function PesquisaPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "pesquisa");

  const rawParams = await searchParams;
  const query = typeof rawParams.q === "string" ? rawParams.q : "";
  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const filters = { ...parseFilters(rawParams, allowedStores), grupoIn };

  const [{ rows, tamanhos }, stores, marcas, tabelasPreco] = await Promise.all([
    searchStockVsSalesComTamanhos(filters, query),
    getStores(allowedStores),
    getMarcas(),
    getTabelasPreco(),
  ]);

  return (
    <div>
      <FilterBar
        action="/dashboard/pesquisa"
        stores={stores}
        marcas={marcas}
        tabelasPreco={tabelasPreco}
        showTabelaPreco
        filters={filters}
      />

      <form action="/dashboard/pesquisa" method="GET" className="mb-4 flex gap-2">
        {(filters.storeIds ?? []).map((id) => (
          <input key={id} type="hidden" name="store" value={id} />
        ))}
        {(filters.marcas ?? []).map((m) => (
          <input key={m} type="hidden" name="marca" value={m} />
        ))}
        {(filters.tabelasPreco ?? []).map((t) => (
          <input key={t} type="hidden" name="tabelaPreco" value={t} />
        ))}
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="Buscar por nome..."
          className="w-full max-w-sm rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
          style={{ colorScheme: "light dark" }}
        />
        <button
          type="submit"
          className="rounded-md bg-[var(--series-1)] px-3 py-1.5 text-sm font-medium text-white"
        >
          Buscar
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Produto</th>
              <th className="px-4 py-2 font-medium">Vendido no período</th>
              {tamanhos.map((t) => (
                <th key={t} className="px-3 py-2 text-center font-medium">
                  {t}
                </th>
              ))}
              <th className="px-4 py-2 font-medium">Total estoque</th>
              <th className="px-4 py-2 font-medium">Sell-through</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((r) => {
              const status = statusFor(r.sellThroughRate);
              return (
                <tr key={r.key} className="border-b border-[var(--gridline)] last:border-0">
                  <td className="px-4 py-2 font-medium">{r.key}</td>
                  <td className="px-4 py-2 tabular-nums">{r.unitsSold.toLocaleString("pt-BR")}</td>
                  {tamanhos.map((t) => {
                    const qtd = r.porTamanho.get(t) ?? 0;
                    return (
                      <td key={t} className="px-3 py-2 text-center tabular-nums text-[var(--text-secondary)]">
                        {qtd > 0 ? qtd.toLocaleString("pt-BR") : "—"}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2 tabular-nums font-medium">{r.currentStock.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {r.sellThroughRate !== null ? `${r.sellThroughRate.toFixed(0)}%` : "—"}
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={5 + tamanhos.length} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  {query ? "Nenhum resultado pra essa busca." : "Digite algo pra buscar."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
