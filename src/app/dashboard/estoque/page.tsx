import { getSessionUser } from "@/lib/auth";
import { getStockVsSalesCombinado, getStockVsSales, getTotalStock, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { StatTile } from "../stat-tile";
import { EstoqueVendasDinamico } from "./estoque-vendas-dinamico";

export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "estoque");

  const rawParams = await searchParams;
  const filtrosOpen = rawParams.filtros === "1";
  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  const [rows, giroRows, totalEstoque, stores, marcas, tabelasPreco] = await Promise.all([
    getStockVsSalesCombinado(filters),
    getStockVsSales(filters, "grupo"),
    getTotalStock({ storeIds: filters.storeIds, grupoIn: filters.grupoIn }),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
  ]);
  const totalVendido = rows.reduce((sum, r) => sum + r.unitsSold, 0);

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/estoque"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          showTabelaPreco
          filters={filters}
        />
      </CollapsibleFilters>

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile label="Estoque atual (total)" value={totalEstoque.toLocaleString("pt-BR")} />
        <StatTile label="Vendido no período (líquido) (total)" value={totalVendido.toLocaleString("pt-BR")} />
      </section>

      <EstoqueVendasDinamico
        rows={rows}
        giroPorGrupo={giroRows.map((r) => ({ key: r.key, sellThroughRate: r.sellThroughRate }))}
      />
    </div>
  );
}
