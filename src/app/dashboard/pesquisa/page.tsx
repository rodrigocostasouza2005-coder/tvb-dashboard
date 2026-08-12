import { getSessionUser } from "@/lib/auth";
import { searchStockVsSalesComTamanhos, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
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
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  const [{ rows, tamanhos }, stores, marcas, tabelasPreco] = await Promise.all([
    searchStockVsSalesComTamanhos(filters, query),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
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
        <div className="relative w-full max-w-sm">
          <svg
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--text-muted)]"
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <circle cx={11} cy={11} r={7} />
            <line x1={21} y1={21} x2={16.65} y2={16.65} />
          </svg>
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Buscar por nome..."
            className="w-full rounded-full border border-[var(--border)] bg-[var(--surface-1)] py-1.5 pr-3 pl-8 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--series-1)]"
            style={{ colorScheme: "light dark" }}
          />
        </div>
        <button
          type="submit"
          className="rounded-full bg-[var(--series-1)] px-4 py-1.5 text-sm font-medium text-white"
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
              const pct = r.sellThroughRate ?? 0;
              return (
                <tr
                  key={r.key}
                  className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]"
                >
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
                  <td className="px-4 py-2">
                    {r.sellThroughRate !== null ? (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--gridline)]">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: status.color }}
                          />
                        </div>
                        <span className="tabular-nums text-[var(--text-secondary)]">{pct.toFixed(0)}%</span>
                      </div>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{ backgroundColor: `color-mix(in srgb, ${status.color} 15%, transparent)`, color: status.color }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} />
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
