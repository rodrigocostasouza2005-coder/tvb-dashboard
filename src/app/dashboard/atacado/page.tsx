import { getSessionUser } from "@/lib/auth";
import { getAtacadoVendas } from "@/lib/metrics";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
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

  const filters = parseFilters(await searchParams, {});

  // Só B2B (Tabela atacado) — sem isso misturava com o varejo do site, que passa pela mesma
  // loja física "Site+Atacado".
  const data = await getAtacadoVendas({ ...filters, tabelasPreco: ["Tabela atacado"] });

  const { kpis, byDay, topProdutos } = data;

  return (
    <div>
      <FilterBar
        action="/dashboard/atacado"
        stores={[]}
        marcas={[]}
        tabelasPreco={[]}
        showMarca={false}
        showDate
        filters={filters}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Receita"
          value={kpis.receita.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        />
        <StatTile label="Pedidos" value={kpis.pedidos.toLocaleString("pt-BR")} />
        <StatTile label="Unidades" value={kpis.unidades.toLocaleString("pt-BR")} />
        <StatTile
          label="Ticket Médio"
          value={kpis.ticketMedio.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        />
      </div>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Receita por dia</h2>
        <AtacadoTrendChart data={byDay} />
      </section>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Receita por grupo (top 12)</h2>
        <AtacadoGruposChart rows={topProdutos} />
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Detalhe por grupo e produto</h2>
        <AtacadoProdutosTable rows={topProdutos} />
      </section>
    </div>
  );
}
