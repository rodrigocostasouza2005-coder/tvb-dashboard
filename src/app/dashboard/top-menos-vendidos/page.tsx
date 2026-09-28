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

export default async function TopMenosVendidosPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "top-menos-vendidos");

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
  // Líquido (desconta devolução) — pedido do Rodrigo em 2026-08-24.
  const allRows = netByReturns(allRowsBrutas, returns);

  // Estoque atual ao lado do ranking de vendas — pedido do Rodrigo em 2026-09-28.
  const estoqueByProduto = new Map(estoquePorProduto.map((e) => [e.key, e.quantidade]));

  const showFinancials = canSeeFinancials(user);

  // Menos vendidos = produtos com menor número de unidades líquidas vendidas (mas ao menos 1)
  const bottom = [...allRows]
    .filter((r) => r.unitsSold > 0)
    .sort((a, b) => a.unitsSold - b.unitsSold)
    .slice(0, LIMIT);

  // Dropdown de tamanho (estoque disponível + vendido) — só busca pros 10 produtos do ranking,
  // pedido do Rodrigo em 2026-09-28.
  const tamanhoPorProduto = await getTamanhoBreakdown(filters, bottom.map((r) => r.key));
  const bottomComTamanhos = bottom.map((r) => ({
    ...r,
    estoque: estoqueByProduto.get(r.key) ?? 0,
    tamanhos: tamanhoPorProduto.get(r.key) ?? [],
  }));

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/top-menos-vendidos"
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
          Top {LIMIT} produtos menos vendidos (por unidades líquidas)
        </h2>
        <MetricBarChart
          data={bottom.map((r) => ({ key: r.key, value: r.unitsSold }))}
          format="number"
          color="var(--cat-3)"
        />
      </section>

      <TopProdutosTable rows={bottomComTamanhos} showFinancials={showFinancials} />
    </div>
  );
}
