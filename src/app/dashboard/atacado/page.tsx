import { getSessionUser } from "@/lib/auth";
import { getAtacadoVendas } from "@/lib/metrics";
import { canSeeFinancials, getGrupoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { StatTile } from "../stat-tile";
import { AtacadoTrendChart } from "./atacado-trend-chart";
import { AtacadoGruposChart } from "./atacado-grupos-chart";
import { AtacadoProdutosTable } from "./atacado-produtos-table";

export default async function AtacadoPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "atacado");
  const filtrosOpen = (await searchParams).filtros === "1";

  const grupoIn = await getGrupoRestriction(user.role);
  const filters = { ...parseFilters(await searchParams, {}), grupoIn };
  const showFinancials = canSeeFinancials(user);

  // getAtacadoVendas já filtra só B2B por dentro (canalWhere("b2b"), cliente-level).
  const data = await getAtacadoVendas(filters);

  const { kpis, byDay, topProdutos } = data;

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/atacado"
          stores={[]}
          marcas={[]}
          tabelasPreco={[]}
          showMarca={false}
          showDate
          filters={filters}
        />
      </CollapsibleFilters>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {showFinancials && (
          <StatTile
            label="Receita bruta"
            value={kpis.receita.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          />
        )}
        <StatTile label="Pedidos" value={kpis.pedidos.toLocaleString("pt-BR")} />
        <StatTile label="Unidades brutas" value={kpis.unidades.toLocaleString("pt-BR")} />
        {showFinancials && (
          <StatTile
            label="Ticket Médio"
            value={kpis.ticketMedio.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          />
        )}
      </div>

      {showFinancials && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Receita bruta por dia</h2>
          <AtacadoTrendChart data={byDay} />
        </section>
      )}

      {showFinancials && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Receita bruta por grupo (top 12)</h2>
          <AtacadoGruposChart rows={topProdutos} />
        </section>
      )}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Detalhe por grupo e produto</h2>
        <AtacadoProdutosTable rows={topProdutos} showReceita={showFinancials} />
      </section>
    </div>
  );
}
