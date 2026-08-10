import { getSessionUser } from "@/lib/auth";
import { getStockVsSales, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { parseFilters, parseDimension, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { BarCompare } from "../bar-compare";
import { DimensionToggle } from "../dimension-toggle";
import { GrupoDrillSelect } from "./grupo-drill-select";

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
  const allowedStores = getStoreRestriction(user);
  const filters = { ...parseFilters(rawParams, allowedStores), grupoIn };

  // Grupo escolhido no drill-down (só ativo quando a dimensão é grupo — não faz sentido drillar
  // dentro de um grupo se já estamos vendo por Produto ou Tamanho): força ver por Produto,
  // restrito a esse grupo só.
  const grupoDrill = dimension === "grupo" && typeof rawParams.grupo === "string" ? rawParams.grupo : "";
  const effectiveFilters = grupoDrill ? { ...filters, grupoIn: [grupoDrill] } : filters;
  const effectiveDimension = grupoDrill ? "produto" : dimension;

  const [rows, grupoRows, stores, marcas, tabelasPreco] = await Promise.all([
    getStockVsSales(effectiveFilters, effectiveDimension),
    dimension === "grupo" ? getStockVsSales(filters, "grupo") : Promise.resolve([]),
    getStores(allowedStores),
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
      {dimension === "grupo" && (
        <GrupoDrillSelect grupos={grupoRows.map((r) => r.key)} current={grupoDrill} />
      )}
      <BarCompare
        rows={rows.slice(0, 40).map((r) => ({ label: r.key, a: r.currentStock, b: r.unitsSold }))}
        labelA="Estoque atual"
        labelB="Vendido no período"
      />
    </div>
  );
}
