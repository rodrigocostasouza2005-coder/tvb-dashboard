import { getSessionUser } from "@/lib/auth";
import { getStockVsSales, getSellthroughByColecao, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, parseDimension, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { DimensionToggle } from "../dimension-toggle";
import { statusFor } from "../status-filter";
import { SellthroughTable } from "./sellthrough-table";
import { SellthroughBarChart } from "./sellthrough-bar-chart";
import { ColecaoSellthroughTable } from "./colecao-sellthrough-table";

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
  const isColecao = dimension === "colecao";

  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  const [colecaoRows, stockVsSalesRows, stores, marcas, tabelasPreco] = await Promise.all([
    isColecao ? getSellthroughByColecao(filters) : Promise.resolve([]),
    isColecao ? Promise.resolve([]) : getStockVsSales(filters, dimension),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
  ]);

  const withStatus = stockVsSalesRows.map((r) => ({ ...r, status: statusFor(r.sellThroughRate) }));

  return (
    <div>
      <FilterBar
        action="/dashboard/sellthrough"
        stores={stores}
        marcas={marcas}
        tabelasPreco={tabelasPreco}
        showTabelaPreco
        showDate={!isColecao}
        filters={filters}
      />
      <div className="mb-1 flex flex-wrap items-center gap-4">
        <DimensionToggle basePath="/dashboard/sellthrough" searchParams={rawParams} current={dimension} showColecao />
      </div>

      {isColecao ? (
        <>
          <p className="mb-3 text-xs text-[var(--text-muted)]">
            Sell-through por coleção = total vendido / total produzido. Sem filtro de data — cobre toda a vida da coleção.
          </p>
          <ColecaoSellthroughTable rows={colecaoRows} />
        </>
      ) : (
        <>
          <p className="mb-3 text-xs text-[var(--text-muted)]">
            Sell-through = vendido / (vendido + estoque atual). Giro = vendido / estoque atual (aproximação
            até termos série histórica de estoque via sync automático).
          </p>
          <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
            <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
              Sell-through por {dimension === "grupo" ? "grupo" : dimension === "produto" ? "produto" : "tamanho"}
            </h2>
            <SellthroughBarChart data={withStatus} />
          </section>
          <SellthroughTable
            rows={withStatus}
            dimensionLabel={dimension === "grupo" ? "Grupo" : dimension === "produto" ? "Produto" : "Tamanho"}
          />
        </>
      )}
    </div>
  );
}
