import { getSessionUser } from "@/lib/auth";
import { getSalesByGrupoProduto, getReturnsByGrupoProduto, netByReturns, getStores, getMarcas, getTabelasPreco, getDistinctColecoes, getEstoqueAtualPorGrupoProduto, getTamanhoBreakdown } from "@/lib/metrics";
import { canSeeFinancials, getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestrictionSemAtacado } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { MetricBarChart } from "../metric-bar-chart";
import { TopProdutosTable } from "../top-produtos-table";

const LIMIT = 10;

export default async function TopMaisVendidosPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "top-mais-vendidos");

  const rawParams = await searchParams;
  const filtrosOpen = rawParams.filtros === "1";
  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestrictionSemAtacado(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  const [allRowsBrutas, returns, stores, marcas, tabelasPreco, colecoes, estoquePorProduto] = await Promise.all([
    getSalesByGrupoProduto(filters),
    getReturnsByGrupoProduto(filters),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getDistinctColecoes(),
    getEstoqueAtualPorGrupoProduto(filters),
  ]);
  // Líquido (desconta devolução) — pedido do Rodrigo em 2026-08-24. Reordena depois de
  // descontar, já que a devolução pode mudar quem é "mais vendido" de verdade.
  const allRows = netByReturns(allRowsBrutas, returns).sort((a, b) => b.revenue - a.revenue);

  // Estoque atual ao lado do ranking de vendas — pedido do Rodrigo em 2026-09-28.
  const estoqueByProduto = new Map(estoquePorProduto.map((e) => [e.key, e.quantidade]));

  const showFinancials = canSeeFinancials(user);
  const top = allRows.slice(0, LIMIT);

  // Dropdown de tamanho (estoque disponível + vendido) — só busca pros 10 produtos do ranking,
  // pedido do Rodrigo em 2026-09-28.
  const tamanhoPorProduto = await getTamanhoBreakdown(filters, top.map((r) => r.key));
  const topComTamanhos = top.map((r) => ({
    ...r,
    estoque: estoqueByProduto.get(r.key) ?? 0,
    tamanhos: tamanhoPorProduto.get(r.key) ?? [],
  }));

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/top-mais-vendidos"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          colecoes={colecoes}
          showTabelaPreco
          filters={filters}
        />
      </CollapsibleFilters>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
          Top {LIMIT} produtos {showFinancials ? "por receita líquida" : "por unidades líquidas"}
        </h2>
        <MetricBarChart
          data={top.map((r) => ({ key: r.key, value: showFinancials ? r.revenue : r.unitsSold }))}
          format={showFinancials ? "currency" : "number"}
          color="var(--series-1)"
        />
      </section>

      <TopProdutosTable rows={topComTamanhos} showFinancials={showFinancials} />
    </div>
  );
}
