import { getSessionUser } from "@/lib/auth";
import { getStockVsSales, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { getGrupoRestriction } from "@/lib/permissions";
import { parseFilters, parseDimension, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { BarCompare } from "../bar-compare";
import { DimensionToggle } from "../dimension-toggle";

export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "estoque");

  const rawParams = await searchParams;
  const dimension = parseDimension(rawParams);
  const grupoIn = await getGrupoRestriction(user.role);
  const filters = { ...parseFilters(rawParams), grupoIn };

  const [rows, stores, marcas, tabelasPreco] = await Promise.all([
    getStockVsSales(filters, dimension),
    getStores(),
    getMarcas(),
    getTabelasPreco(),
  ]);

  return (
    <div>
      <FilterBar
        action="/dashboard/estoque"
        stores={stores}
        marcas={marcas}
        tabelasPreco={tabelasPreco}
        showTabelaPreco
        filters={filters}
      />
      <DimensionToggle basePath="/dashboard/estoque" searchParams={rawParams} current={dimension} />
      <BarCompare
        rows={rows.slice(0, 40).map((r) => ({ label: r.key, a: r.currentStock, b: r.unitsSold }))}
        labelA="Estoque atual"
        labelB="Vendido no período"
      />
    </div>
  );
}
