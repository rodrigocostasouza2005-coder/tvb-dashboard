import { getSessionUser } from "@/lib/auth";
import { getStockVsSales, getReturnsByDimension, netByReturns, getTotalStock, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, parseDimension, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { BarCompare } from "../bar-compare";
import { DimensionToggle } from "../dimension-toggle";
import { StatTile } from "../stat-tile";
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
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  // Grupo escolhido no drill-down (só ativo quando a dimensão é grupo — não faz sentido drillar
  // dentro de um grupo se já estamos vendo por Produto ou Tamanho): força ver por Produto,
  // restrito a esse grupo só.
  const grupoDrill = dimension === "grupo" && typeof rawParams.grupo === "string" ? rawParams.grupo : "";
  const effectiveFilters = grupoDrill ? { ...filters, grupoIn: [grupoDrill] } : filters;
  const effectiveDimension = grupoDrill ? "produto" : dimension;

  const [rowsBrutas, returns, totalEstoque, grupoRows, stores, marcas, tabelasPreco] = await Promise.all([
    getStockVsSales(effectiveFilters, effectiveDimension),
    getReturnsByDimension(effectiveFilters, effectiveDimension),
    getTotalStock({ storeIds: filters.storeIds, grupoIn: filters.grupoIn }),
    dimension === "grupo" ? getStockVsSales(filters, "grupo") : Promise.resolve([]),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
  ]);
  // Vendido líquido (desconta devolução) — pedido do Rodrigo em 2026-08-24.
  const rows = netByReturns(rowsBrutas, returns).sort((a, b) => b.unitsSold - a.unitsSold);

  const dimensionLabel = effectiveDimension === "produto" ? "Produto" : effectiveDimension === "tamanho" ? "Tamanho" : "Grupo";
  const totalVendido = rows.reduce((sum, r) => sum + r.unitsSold, 0);
  const top40 = rows.slice(0, 40);

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

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile label="Estoque atual (total)" value={totalEstoque.toLocaleString("pt-BR")} />
        <StatTile label="Vendido no período (líquido) (total)" value={totalVendido.toLocaleString("pt-BR")} />
        <StatTile label={`${dimensionLabel}s no comparativo`} value={rows.length.toLocaleString("pt-BR")} />
      </section>

      <DimensionToggle basePath="/dashboard/estoque" searchParams={rawParams} current={dimension} />
      {dimension === "grupo" && (
        <GrupoDrillSelect grupos={grupoRows.map((r) => r.key)} current={grupoDrill} />
      )}

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
          Estoque atual × vendido — top {top40.length} {dimensionLabel.toLowerCase()}s
        </h2>
        <BarCompare
          rows={top40.map((r) => ({ label: r.key, a: r.currentStock, b: r.unitsSold }))}
          labelA="Estoque atual"
          labelB="Vendido no período (líquido)"
          colorA="#eb6834"
          colorB="#2a78d6"
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Números exatos</h2>
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">{dimensionLabel}</th>
                <th className="px-4 py-2 font-medium">Estoque atual</th>
                <th className="px-4 py-2 font-medium">Vendido no período (líquido)</th>
                <th className="px-4 py-2 font-medium">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {top40.map((r) => {
                const diff = r.currentStock - r.unitsSold;
                return (
                  <tr key={r.key} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                    <td className="px-4 py-2 font-medium">{r.key}</td>
                    <td className="px-4 py-2 tabular-nums">{r.currentStock.toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-2 tabular-nums">{r.unitsSold.toLocaleString("pt-BR")}</td>
                    <td
                      className="px-4 py-2 tabular-nums font-medium"
                      style={{ color: diff < 0 ? "var(--status-critical)" : "var(--text-secondary)" }}
                    >
                      {diff > 0 ? "+" : ""}
                      {diff.toLocaleString("pt-BR")}
                    </td>
                  </tr>
                );
              })}
              {top40.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Sem dados para o período/filtro selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
