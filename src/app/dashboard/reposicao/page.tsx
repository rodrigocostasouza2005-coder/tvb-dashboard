import { getSessionUser } from "@/lib/auth";
import { getReplenishment, getStores, getMarcas, getDistinctColecoes } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { parseFilters, toDateInputValue, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { MetricBarChart } from "../metric-bar-chart";

export default async function ReposicaoPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "reposicao");

  const rawParams = await searchParams;
  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const colecaoSelecionada = Array.isArray(rawParams.colecao)
    ? rawParams.colecao
    : typeof rawParams.colecao === "string" && rawParams.colecao
    ? [rawParams.colecao]
    : [];
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores }),
    grupoIn,
    colecaoIn: colecaoSelecionada.length ? colecaoSelecionada : undefined,
  };
  const [rows, stores, marcas, colecoes] = await Promise.all([
    getReplenishment(filters),
    getStores(allowedStores),
    getMarcas(),
    getDistinctColecoes(),
  ]);

  const exportParams = new URLSearchParams();
  for (const id of filters.storeIds ?? []) exportParams.append("store", id);
  for (const c of colecaoSelecionada) exportParams.append("colecao", c);
  exportParams.set("from", toDateInputValue(filters.from));
  exportParams.set("to", toDateInputValue(filters.to));

  function colecaoToggleHref(colecao: string) {
    const next = colecaoSelecionada.includes(colecao)
      ? colecaoSelecionada.filter((c) => c !== colecao)
      : [...colecaoSelecionada, colecao];
    const params = new URLSearchParams();
    for (const id of filters.storeIds ?? []) params.append("store", id);
    for (const c of next) params.append("colecao", c);
    return `/dashboard/reposicao?${params.toString()}`;
  }
  const colecaoAllHref = (() => {
    const params = new URLSearchParams();
    for (const id of filters.storeIds ?? []) params.append("store", id);
    return `/dashboard/reposicao?${params.toString()}`;
  })();

  return (
    <div>
      <CollapsibleFilters>
        <FilterBar action="/dashboard/reposicao" stores={stores} marcas={marcas} filters={filters} showMarca={false} showDate={false} />
      </CollapsibleFilters>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-[var(--text-muted)]">Coleção:</span>
        <a
          href={colecaoAllHref}
          className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
            colecaoSelecionada.length === 0
              ? "border-[var(--series-1)] bg-[var(--series-1)] text-white"
              : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
          }`}
        >
          Todas
        </a>
        {colecoes.map((c) => (
          <a
            key={c}
            href={colecaoToggleHref(c)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              colecaoSelecionada.includes(c)
                ? "border-[var(--series-1)] bg-[var(--series-1)] text-white"
                : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
            }`}
          >
            {c}
          </a>
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">
          Mostra itens com estoque abaixo do mínimo e com estoque disponível na origem pra
          repor de verdade — o que está abaixo do mínimo mas sem nada pra puxar não aparece aqui.
        </p>
        <a
          href={`/api/export/reposicao?${exportParams.toString()}`}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
        >
          Exportar CSV
        </a>
      </div>

      {rows.length > 0 && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Unidades faltando por loja</h2>
          <MetricBarChart
            data={Object.entries(
              rows.reduce<Record<string, number>>((acc, r) => {
                acc[r.storeName] = (acc[r.storeName] ?? 0) + r.falta;
                return acc;
              }, {})
            )
              .map(([key, value]) => ({ key, value }))
              .sort((a, b) => b.value - a.value)}
            color="var(--status-critical)"
          />
        </section>
      )}

      <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Loja</th>
              <th className="px-4 py-2 font-medium">Coleção</th>
              <th className="px-4 py-2 font-medium">Produto</th>
              <th className="px-4 py-2 font-medium">Tamanho</th>
              <th className="px-4 py-2 font-medium">Estoque</th>
              <th className="px-4 py-2 font-medium">Repor</th>
              <th className="px-4 py-2 font-medium">Mínimo</th>
              <th className="px-4 py-2 font-medium">Repor de</th>
              <th className="px-4 py-2 font-medium">Disponível na origem</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[var(--gridline)] last:border-0">
                <td className="px-4 py-2">{r.storeName}</td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{r.colecao ?? "—"}</td>
                <td className="px-4 py-2 font-medium">{r.produto}</td>
                <td className="px-4 py-2">{r.tamanho ?? "—"}</td>
                <td className="px-4 py-2 tabular-nums">{r.quantidadeDisponivel}</td>
                <td className="px-4 py-2 tabular-nums font-medium" style={{ color: "var(--status-critical)" }}>
                  {r.falta}
                </td>
                <td className="px-4 py-2 tabular-nums">{r.estoqueMinimo}</td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{r.origemSugerida}</td>
                <td className="px-4 py-2 tabular-nums">{r.estoqueNaOrigem}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Nada abaixo do estoque mínimo no filtro atual.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
