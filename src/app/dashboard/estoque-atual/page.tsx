import { getSessionUser } from "@/lib/auth";
import { getEstoqueAtual, getEstoqueAtualPorGrupoProduto, getEstoquePorArmazenador, getAllStores, getMarcas } from "@/lib/metrics";
import { getGrupoRestriction, canSeeFinancials, getStoreRestriction } from "@/lib/permissions";
import { parseFilters, parseDimension, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { DimensionToggle } from "../dimension-toggle";
import { PieChart } from "../pie-chart";
import { MetricBarChart } from "../metric-bar-chart";
import { ExpandableStockTable } from "./expandable-stock-table";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function EstoqueAtualPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "estoque-atual");

  const rawParams = await searchParams;
  const dimension = parseDimension(rawParams);
  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const filters = { ...parseFilters(rawParams, { allowedStoreIds: allowedStores }), grupoIn };
  const q = typeof rawParams.q === "string" ? rawParams.q.trim().toLowerCase() : "";

  const [allRows, produtoRows, porArmazenador, stores, marcas] = await Promise.all([
    getEstoqueAtual(filters, dimension),
    dimension === "grupo" ? getEstoqueAtualPorGrupoProduto(filters) : Promise.resolve([] as Awaited<ReturnType<typeof getEstoqueAtualPorGrupoProduto>>),
    getEstoquePorArmazenador(filters),
    getAllStores(allowedStores),
    getMarcas(),
  ]);
  const rows = q ? allRows.filter((r) => r.key.toLowerCase().includes(q)) : allRows;
  const showFinancials = canSeeFinancials(user);
  const totalQuantidade = rows.reduce((sum, r) => sum + r.quantidade, 0);
  const totalCusto = rows.reduce((sum, r) => sum + r.valorCusto, 0);

  return (
    <div>
      <CollapsibleFilters>
        <FilterBar action="/dashboard/estoque-atual" stores={stores} marcas={marcas} filters={filters} showMarca={false} />
      </CollapsibleFilters>
      <DimensionToggle basePath="/dashboard/estoque-atual" searchParams={rawParams} current={dimension} />

      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Estoque atual em tempo real, direto da API do DAPIC — escolha quais armazenadores ver no
        filtro de loja acima (inclui os que não são ponto de venda, tipo Defeito e Bonificação).
      </p>

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <div className="text-xs font-medium text-[var(--text-muted)]">Unidades em estoque</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{totalQuantidade.toLocaleString("pt-BR")}</div>
        </div>
        {showFinancials && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
            <div className="text-xs font-medium text-[var(--text-muted)]">Valor de custo total</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{formatBRL(totalCusto)}</div>
          </div>
        )}
      </section>

      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">% de estoque por armazenador</h2>
          <PieChart
            data={porArmazenador.map((p) => ({ label: p.storeName, value: p.quantidade, percentual: p.percentual }))}
          />
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            Top {dimension === "grupo" ? "grupo" : dimension === "produto" ? "produto" : "tamanho"} em estoque
          </h2>
          <MetricBarChart data={rows.slice(0, 10).map((r) => ({ key: r.key, value: r.quantidade }))} />
        </div>
      </section>

      {dimension !== "grupo" && (
        <form method="get" action="/dashboard/estoque-atual" className="mb-3 flex gap-2">
          <input type="hidden" name="dim" value={dimension} />
          {typeof rawParams.store === "string" && <input type="hidden" name="store" value={rawParams.store} />}
          <input
            type="search"
            name="q"
            defaultValue={typeof rawParams.q === "string" ? rawParams.q : ""}
            placeholder="Buscar produto..."
            className="w-full max-w-xs rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm outline-none focus:border-[var(--series-1)] focus:ring-1 focus:ring-[var(--series-1)]"
          />
          <button
            type="submit"
            className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm hover:bg-[var(--page-plane)]"
          >
            Buscar
          </button>
          {q && (
            <a
              href={`/dashboard/estoque-atual?dim=${dimension}`}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm hover:bg-[var(--page-plane)] text-[var(--text-muted)]"
            >
              Limpar
            </a>
          )}
        </form>
      )}

      {dimension === "grupo" ? (
        <ExpandableStockTable
          rows={rows}
          produtoRows={produtoRows}
          totalQuantidade={totalQuantidade}
          showFinancials={showFinancials}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">
                  {dimension === "produto" ? "Produto" : "Tamanho"}
                </th>
                <th className="px-4 py-2 font-medium">Quantidade</th>
                {showFinancials && <th className="px-4 py-2 font-medium">Valor de custo</th>}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 100).map((r) => (
                <tr key={r.key} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium">{r.key}</td>
                  <td className="px-4 py-2 tabular-nums">{r.quantidade.toLocaleString("pt-BR")}</td>
                  {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(r.valorCusto)}</td>}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={showFinancials ? 3 : 2} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Sem estoque pro filtro selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
