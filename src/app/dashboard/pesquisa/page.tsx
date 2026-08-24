import { getSessionUser } from "@/lib/auth";
import { searchStockVsSalesComTamanhos, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { PesquisaTable } from "./pesquisa-table";

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
      <CollapsibleFilters>
        <FilterBar
          action="/dashboard/pesquisa"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          showTabelaPreco
          filters={filters}
        />
      </CollapsibleFilters>

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

      <PesquisaTable
        rows={rows.slice(0, 100).map((r) => ({
          key: r.key,
          unitsSold: r.unitsSold,
          currentStock: r.currentStock,
          sellThroughRate: r.sellThroughRate,
          porTamanho: Object.fromEntries(r.porTamanho),
          porLoja: [...r.porLoja.entries()]
            .map(([loja, porTamanho]) => ({
              loja,
              porTamanho: Object.fromEntries(porTamanho),
              total: [...porTamanho.values()].reduce((sum, v) => sum + v, 0),
            }))
            .sort((a, b) => b.total - a.total),
        }))}
        tamanhos={tamanhos}
        emptyMessage={query ? "Nenhum resultado pra essa busca." : "Digite algo pra buscar."}
      />
    </div>
  );
}
