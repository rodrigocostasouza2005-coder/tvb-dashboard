import { getSessionUser } from "@/lib/auth";
import { getAtacadoCidades, getTabelasPreco } from "@/lib/metrics";
import { getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { StatTile } from "../stat-tile";
import { CidadesChart } from "./cidades-chart";
import { CidadesTable } from "./cidades-table";

export default async function AtacadoCidadesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "atacado-cidades");

  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = parseFilters(await searchParams, { allowedTabelasPreco });

  const [data, tabelasPreco] = await Promise.all([
    getAtacadoCidades(filters),
    getTabelasPreco(allowedTabelasPreco),
  ]);

  const totalReceita = data.rows.reduce((sum, r) => sum + r.receita, 0);

  return (
    <div>
      <FilterBar
        action="/dashboard/atacado-cidades"
        stores={[]}
        marcas={[]}
        tabelasPreco={tabelasPreco}
        showMarca={false}
        showTabelaPreco
        showDate
        filters={filters}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Cidades atendidas" value={String(data.totalCidades)} />
        <StatTile label="Estados" value={String(data.totalEstados)} />
        <StatTile
          label="Total Receita"
          value={totalReceita.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        />
      </div>

      {data.rows.length > 0 && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Top 15 cidades por receita</h2>
          <CidadesChart rows={data.rows} />
        </section>
      )}

      <CidadesTable rows={data.rows} />
    </div>
  );
}
