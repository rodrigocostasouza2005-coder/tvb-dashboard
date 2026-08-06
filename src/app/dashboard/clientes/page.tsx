import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getTopClientes, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { canSeeFinancials } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { FilterBar } from "../filter-bar";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  if (user.role === "VENDEDOR") redirect("/dashboard");

  const filters = parseFilters(await searchParams);
  const [rows, stores, marcas, tabelasPreco] = await Promise.all([
    getTopClientes(filters),
    getStores(),
    getMarcas(),
    getTabelasPreco(),
  ]);
  const showFinancials = canSeeFinancials(user.role);

  return (
    <div>
      <FilterBar
        action="/dashboard/clientes"
        stores={stores}
        marcas={marcas}
        tabelasPreco={tabelasPreco}
        showTabelaPreco
        filters={filters}
      />
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Use o filtro de tabela de preço pra separar varejo de atacado. Segmentação e recorrência mais
        avançadas entram numa próxima etapa.
      </p>
      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Pedidos</th>
              <th className="px-4 py-2 font-medium">Unidades</th>
              {showFinancials && <th className="px-4 py-2 font-medium">Receita</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cliente} className="border-b border-[var(--gridline)] last:border-0">
                <td className="px-4 py-2 font-medium">{r.cliente}</td>
                <td className="px-4 py-2 tabular-nums">{r.pedidos}</td>
                <td className="px-4 py-2 tabular-nums">{r.unidades}</td>
                {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(r.receita)}</td>}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={showFinancials ? 4 : 3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Sem vendas no período/filtro selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
