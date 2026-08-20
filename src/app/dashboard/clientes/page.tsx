import { getSessionUser } from "@/lib/auth";
import { getTopClientes, getStores, getMarcas, getTabelasPreco, getVendedores, getClienteRetencaoVarejo } from "@/lib/metrics";
import { canSeeFinancials, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { MetricBarChart } from "../metric-bar-chart";
import { StatTile } from "../stat-tile";
import { ClienteRetencaoChart } from "./cliente-retencao-chart";

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
  requireTabAccess(user, user.role, "clientes");

  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const rawParams = await searchParams;
  const filters = parseFilters(rawParams, {
    allowedStoreIds: allowedStores,
    allowedMarcas,
    allowedTabelasPreco,
  });
  const vendedor = typeof rawParams.vendedor === "string" && rawParams.vendedor ? rawParams.vendedor : null;

  const [rows, stores, marcas, tabelasPreco, vendedores, retencao] = await Promise.all([
    getTopClientes(filters, vendedor),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getVendedores(),
    getClienteRetencaoVarejo(filters),
  ]);
  const showFinancials = canSeeFinancials(user);

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
      <form method="get" action="/dashboard/clientes" className="mb-3 flex flex-wrap items-center gap-2">
        {/* Preserva os filtros existentes ao filtrar por vendedor */}
        {filters.storeIds?.map((id) => <input key={id} type="hidden" name="store" value={id} />)}
        {filters.marcas?.map((m) => <input key={m} type="hidden" name="marca" value={m} />)}
        {filters.tabelasPreco?.map((t) => <input key={t} type="hidden" name="tabelaPreco" value={t} />)}
        {typeof rawParams.from === "string" && rawParams.from && <input type="hidden" name="from" value={rawParams.from} />}
        {typeof rawParams.to === "string" && rawParams.to && <input type="hidden" name="to" value={rawParams.to} />}
        <label className="text-xs text-[var(--text-muted)]">Vendedor:</label>
        <select
          name="vendedor"
          defaultValue={vendedor ?? ""}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm outline-none focus:border-[var(--series-1)] focus:ring-1 focus:ring-[var(--series-1)]"
        >
          <option value="">Todos</option>
          {vendedores.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <button type="submit" className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm hover:bg-[var(--page-plane)]">
          Filtrar
        </button>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-2">
        <StatTile label="Compraram 1x" value={retencao.compraram1x.toLocaleString("pt-BR")} />
        <StatTile
          label="Compraram +1x"
          value={retencao.compraramMaisde1x.toLocaleString("pt-BR")}
          trend={retencao.compraramMaisde1x > 0 ? "up" : undefined}
        />
      </div>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
          Top clientes {showFinancials ? "por receita" : "por unidades"}
        </h2>
        <MetricBarChart
          data={rows.slice(0, 10).map((r) => ({ key: r.cliente, value: showFinancials ? r.receita : r.unidades }))}
          format={showFinancials ? "currency" : "number"}
          color="var(--cat-3)"
        />
      </section>

      <div className="mb-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Contato</th>
              <th className="px-4 py-2 font-medium">Pedidos</th>
              <th className="px-4 py-2 font-medium">Unidades</th>
              {showFinancials && <th className="px-4 py-2 font-medium">Receita</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cliente} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                <td className="px-4 py-2 font-medium">{r.cliente}</td>
                <td className="px-4 py-2">
                  {r.telefone ? (
                    <a
                      href={`tel:${r.telefone}`}
                      className="text-[var(--series-1)] hover:underline tabular-nums"
                    >
                      {r.telefone}
                    </a>
                  ) : (
                    <span className="text-[var(--text-muted)]">—</span>
                  )}
                  {r.email && (
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">{r.email}</div>
                  )}
                </td>
                <td className="px-4 py-2 tabular-nums">{r.pedidos}</td>
                <td className="px-4 py-2 tabular-nums">{r.unidades}</td>
                {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(r.receita)}</td>}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={showFinancials ? 5 : 4} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Sem vendas no período/filtro selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {retencao.months.length > 1 && (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Retenção — novos vs recorrentes por mês</h2>
          <ClienteRetencaoChart data={retencao.months} />
        </section>
      )}
    </div>
  );
}
