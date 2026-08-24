import { getSessionUser } from "@/lib/auth";
import { getAtacadoClientes, getClienteRetencaoPorMes } from "@/lib/metrics";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { StatTile } from "../stat-tile";
import { ClientesTable } from "./clientes-table";
import { ClienteRetencaoChart } from "./cliente-retencao-chart";

export default async function AtacadoClientesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "atacado-clientes");
  const filtrosOpen = (await searchParams).filtros === "1";

  const filters = parseFilters(await searchParams, {});

  const [data, retencao] = await Promise.all([
    getAtacadoClientes(filters),
    getClienteRetencaoPorMes(filters),
  ]);

  const totalReceita = data.rows.reduce((sum, r) => sum + r.receita, 0);

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/atacado-clientes"
          stores={[]}
          marcas={[]}
          tabelasPreco={[]}
          showMarca={false}
          showDate
          filters={filters}
        />
      </CollapsibleFilters>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Clientes únicos" value={String(data.totalClientes)} />
        <StatTile
          label="Novos no período"
          value={String(data.novosNoPeriodo)}
          status={data.novosNoPeriodo > 0 ? "good" : undefined}
          trend={data.novosNoPeriodo > 0 ? "up" : undefined}
        />
        <StatTile
          label="Total Receita bruta"
          value={totalReceita.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        />
        <StatTile label="Compraram 1x" value={String(retencao.compraram1x)} />
        <StatTile
          label="Compraram +1x"
          value={String(retencao.compraramMaisde1x)}
          trend={retencao.compraramMaisde1x > 0 ? "up" : undefined}
        />
      </div>

      {retencao.months.length > 1 && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Retenção — novos vs recorrentes por mês</h2>
          <ClienteRetencaoChart data={retencao.months} />
        </section>
      )}

      <ClientesTable rows={data.rows} />
    </div>
  );
}
