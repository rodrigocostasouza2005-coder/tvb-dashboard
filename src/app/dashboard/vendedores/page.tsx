import { getSessionUser } from "@/lib/auth";
import { getVendedorRanking, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { canSeeFinancials } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";

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

  const filters = parseFilters(await searchParams);
  const [rows, stores, marcas, tabelasPreco] = await Promise.all([
    getVendedorRanking(filters),
    getStores(),
    getMarcas(),
    getTabelasPreco(),
  ]);
  const showFinancials = canSeeFinancials(user.role);

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

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-4 py-2 font-medium">Vendedor</th>
              <th className="px-4 py-2 font-medium">Loja</th>
              <th className="px-4 py-2 font-medium">Vendas</th>
              <th className="px-4 py-2 font-medium">Unidades</th>
              {showFinancials && <th className="px-4 py-2 font-medium">Receita</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.vendedor}-${r.storeName}`} className="border-b border-[var(--gridline)] last:border-0">
                <td className="px-4 py-2 text-[var(--text-muted)]">{i + 1}</td>
                <td className="px-4 py-2 font-medium">{r.vendedor}</td>
                <td className="px-4 py-2">{r.storeName}</td>
                <td className="px-4 py-2 tabular-nums">{r.pedidos}</td>
                <td className="px-4 py-2 tabular-nums">{r.unidades.toLocaleString("pt-BR")}</td>
                {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(r.receita)}</td>}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={showFinancials ? 6 : 5} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Sem vendas com vendedor identificado no período/filtro selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
