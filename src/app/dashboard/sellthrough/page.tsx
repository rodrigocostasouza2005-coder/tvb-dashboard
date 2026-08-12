import { getSessionUser } from "@/lib/auth";
import { getStockVsSales, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, parseDimension, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { DimensionToggle } from "../dimension-toggle";
import { statusFor } from "../status-filter";
import { SellthroughTable } from "./sellthrough-table";

export default async function SellthroughPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "sellthrough");

  const rawParams = await searchParams;
  const dimension = parseDimension(rawParams);
  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  const [rows, stores, marcas, tabelasPreco] = await Promise.all([
    getStockVsSales(filters, dimension),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
  ]);
  const withStatus = rows.map((r) => ({ ...r, status: statusFor(r.sellThroughRate) }));

  return (
    <div>
      <FilterBar
        action="/dashboard/sellthrough"
        stores={stores}
        marcas={marcas}
        tabelasPreco={tabelasPreco}
        showTabelaPreco
        filters={filters}
      />
      <div className="mb-1 flex flex-wrap items-center gap-4">
        <DimensionToggle basePath="/dashboard/sellthrough" searchParams={rawParams} current={dimension} />
      </div>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Sell-through = vendido / (vendido + estoque atual). Giro = vendido / estoque atual (aproximação
        até termos série histórica de estoque via sync automático).
      </p>
      <SellthroughTable
        rows={withStatus}
        dimensionLabel={dimension === "grupo" ? "Grupo" : dimension === "produto" ? "Produto" : "Tamanho"}
      />
    </div>
  );
}
