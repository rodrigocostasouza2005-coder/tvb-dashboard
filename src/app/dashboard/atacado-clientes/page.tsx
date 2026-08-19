import { getSessionUser } from "@/lib/auth";
import { getAtacadoClientes } from "@/lib/metrics";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { StatTile } from "../stat-tile";
import { ClientesTable } from "./clientes-table";

export default async function AtacadoClientesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "atacado-clientes");

  const filters = parseFilters(await searchParams, {});

  const data = await getAtacadoClientes(filters);

  const totalReceita = data.rows.reduce((sum, r) => sum + r.receita, 0);

  return (
    <div>
      <FilterBar
        action="/dashboard/atacado-clientes"
        stores={[]}
        marcas={[]}
        tabelasPreco={[]}
        showMarca={false}
        showDate
        filters={filters}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Clientes únicos" value={String(data.totalClientes)} />
        <StatTile
          label="Novos no período"
          value={String(data.novosNoPeriodo)}
          status={data.novosNoPeriodo > 0 ? "good" : undefined}
          trend={data.novosNoPeriodo > 0 ? "up" : undefined}
        />
        <StatTile
          label="Total Receita"
          value={totalReceita.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        />
      </div>

      <ClientesTable rows={data.rows} />
    </div>
  );
}
