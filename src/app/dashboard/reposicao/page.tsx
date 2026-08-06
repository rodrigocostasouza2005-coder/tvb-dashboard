import { getSessionUser } from "@/lib/auth";
import { getReplenishment, getStores, getMarcas } from "@/lib/metrics";
import { getGrupoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { FilterBar } from "../filter-bar";

export default async function ReposicaoPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;

  const grupoIn = await getGrupoRestriction(user.role);
  const filters = { ...parseFilters(await searchParams), grupoIn };
  const [rows, stores, marcas] = await Promise.all([
    getReplenishment(filters),
    getStores(),
    getMarcas(),
  ]);

  return (
    <div>
      <FilterBar action="/dashboard/reposicao" stores={stores} marcas={marcas} filters={filters} showMarca={false} />
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Mostra apenas itens com estoque abaixo do mínimo definido por loja/tamanho.
      </p>
      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Loja</th>
              <th className="px-4 py-2 font-medium">Grupo</th>
              <th className="px-4 py-2 font-medium">Tamanho</th>
              <th className="px-4 py-2 font-medium">Estoque</th>
              <th className="px-4 py-2 font-medium">Mínimo</th>
              <th className="px-4 py-2 font-medium">Falta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[var(--gridline)] last:border-0">
                <td className="px-4 py-2">{r.storeName}</td>
                <td className="px-4 py-2 font-medium">{r.grupo}</td>
                <td className="px-4 py-2">{r.tamanho ?? "—"}</td>
                <td className="px-4 py-2 tabular-nums">{r.quantidadeDisponivel}</td>
                <td className="px-4 py-2 tabular-nums">{r.estoqueMinimo}</td>
                <td className="px-4 py-2 tabular-nums font-medium" style={{ color: "var(--status-critical)" }}>
                  {r.falta}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--text-muted)]">
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
