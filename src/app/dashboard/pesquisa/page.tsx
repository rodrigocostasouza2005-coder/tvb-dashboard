import { getSessionUser } from "@/lib/auth";
import { searchStockVsSalesComTamanhos, getTopClientes, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { canSeeFinancials, getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { waHref } from "@/lib/whatsapp";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { PesquisaTable } from "./pesquisa-table";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDataNascimento(d: Date | null) {
  if (!d) return null;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
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
  const filtrosOpen = rawParams.filtros === "1";
  const query = typeof rawParams.q === "string" ? rawParams.q : "";
  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  const [{ rows, tamanhos }, clientes, stores, marcas, tabelasPreco] = await Promise.all([
    searchStockVsSalesComTamanhos(filters, query),
    query.trim() ? getTopClientes(filters, null, 20, "todos", true, query) : Promise.resolve([]),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
  ]);
  const showFinancials = canSeeFinancials(user);

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
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

      {clientes.length > 0 && (
        <div className="mb-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="border-b border-[var(--gridline)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)]">
            Clientes encontrados
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Cliente</th>
                <th className="px-4 py-2 font-medium">Contato</th>
                <th className="px-4 py-2 font-medium">Nascimento</th>
                <th className="px-4 py-2 font-medium">Pedidos</th>
                <th className="px-4 py-2 font-medium">Unidades</th>
                {showFinancials && <th className="px-4 py-2 font-medium">Receita bruta</th>}
                {showFinancials && <th className="px-4 py-2 font-medium">Receita líquida</th>}
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.cliente} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium">{c.cliente}</td>
                  <td className="px-4 py-2">
                    {c.telefone ? (
                      <a href={waHref(c.telefone)} target="_blank" rel="noopener noreferrer" className="text-[var(--series-1)] hover:underline tabular-nums">
                        {c.telefone}
                      </a>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                    {c.email && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{c.email}</div>}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
                    {formatDataNascimento(c.dataNascimento) ?? <span className="text-[var(--text-muted)]">—</span>}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{c.pedidos}</td>
                  <td className="px-4 py-2 tabular-nums">{c.unidades.toLocaleString("pt-BR")}</td>
                  {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(c.receitaBruta)}</td>}
                  {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(c.receitaLiquida)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
