import { getSessionUser } from "@/lib/auth";
import { getReplenishment, getStores, getMarcas } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { parseFilters, toDateInputValue, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";

export default async function ReposicaoPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "reposicao");

  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const filters = { ...parseFilters(await searchParams, allowedStores), grupoIn };
  const [rows, stores, marcas] = await Promise.all([
    getReplenishment(filters),
    getStores(allowedStores),
    getMarcas(),
  ]);

  const exportParams = new URLSearchParams();
  for (const id of filters.storeIds ?? []) exportParams.append("store", id);
  exportParams.set("from", toDateInputValue(filters.from));
  exportParams.set("to", toDateInputValue(filters.to));

  return (
    <div>
      <FilterBar action="/dashboard/reposicao" stores={stores} marcas={marcas} filters={filters} showMarca={false} />
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
      <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Loja</th>
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
                <td colSpan={8} className="px-4 py-6 text-center text-[var(--text-muted)]">
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
