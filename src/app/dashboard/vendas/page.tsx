import { getSessionUser } from "@/lib/auth";
import {
  getSalesByDimension,
  getSalesByGrupoProduto,
  getSalesByGrupoProdutoTamanho,
  getSalesByTamanhoProduto,
  getSalesByProdutoTamanho,
  getSalesByDay,
  getSalesByDayPerStore,
  getReturnsByDimension,
  getReturnsByGrupoProduto,
  getReturnsByGrupoProdutoTamanho,
  getReturnsByTamanhoProduto,
  getReturnsByProdutoTamanho,
  getReturnsByDay,
  getStores,
  getMarcas,
  getTabelasPreco,
  getAtacadoCidades,
} from "@/lib/metrics";
import {
  canSeeFinancials,
  getGrupoRestriction,
  getStoreRestriction,
  getMarcaRestriction,
  getTabelaPrecoRestriction,
} from "@/lib/permissions";
import { parseFilters, parseDimension, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { DimensionToggle } from "../dimension-toggle";
import { SalesTrendChart } from "../sales-trend-chart";
import { ReturnsTrendChart } from "../returns-trend-chart";
import { TopBarChart } from "../top-bar-chart";
import { StoreCompareChart } from "../store-compare-chart";
import { BrazilMap } from "../brazil-map";
import { ExpandableSalesTable } from "./expandable-sales-table";
import { ExpandableReturnsTable } from "./expandable-returns-table";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function VendasPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "vendas");

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
  const showFinancials = canSeeFinancials(user);
  // "Mapa de vendas" só cobre o canal Site (varejo dentro de Site+Atacado) — é o único canal
  // com cobertura de cidade praticamente completa (lojas físicas só tem ~50%, cliente avulso
  // sem cadastro não tem endereço). Respeita a mesma restrição de tabela de preço do usuário.
  const canSeeSiteMap = showFinancials && allowedTabelasPreco.includes("Tabela varejo");
  const emptyAtacadoCidades: Awaited<ReturnType<typeof getAtacadoCidades>> = { rows: [], totalCidades: 0, totalEstados: 0 };

  const emptySalesSubRows: Awaited<ReturnType<typeof getSalesByGrupoProduto>> = [];
  const emptyReturnSubRows: Awaited<ReturnType<typeof getReturnsByGrupoProduto>> = [];
  const emptyTamanhoSalesRows: Awaited<ReturnType<typeof getSalesByGrupoProdutoTamanho>> = [];
  const emptyTamanhoReturnRows: Awaited<ReturnType<typeof getReturnsByGrupoProdutoTamanho>> = [];

  const [rows, salesSubRows, salesTamanhoRows, salesByDay, salesByDayPerStore, returnRows, returnSubRows, returnTamanhoRows, returnsByDay, stores, marcas, tabelasPreco, siteCidades] = await Promise.all([
    getSalesByDimension(filters, dimension),
    dimension === "grupo"
      ? getSalesByGrupoProduto(filters)
      : dimension === "tamanho"
      ? getSalesByTamanhoProduto(filters)
      : dimension === "produto"
      ? getSalesByProdutoTamanho(filters)
      : Promise.resolve(emptySalesSubRows),
    dimension === "grupo"
      ? getSalesByGrupoProdutoTamanho(filters)
      : Promise.resolve(emptyTamanhoSalesRows),
    getSalesByDay(filters),
    getSalesByDayPerStore(filters),
    getReturnsByDimension(filters, dimension),
    dimension === "grupo"
      ? getReturnsByGrupoProduto(filters)
      : dimension === "tamanho"
      ? getReturnsByTamanhoProduto(filters)
      : dimension === "produto"
      ? getReturnsByProdutoTamanho(filters)
      : Promise.resolve(emptyReturnSubRows),
    dimension === "grupo"
      ? getReturnsByGrupoProdutoTamanho(filters)
      : Promise.resolve(emptyTamanhoReturnRows),
    getReturnsByDay(filters),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    canSeeSiteMap ? getAtacadoCidades({ ...filters, tabelasPreco: ["Tabela varejo"] }) : Promise.resolve(emptyAtacadoCidades),
  ]);
  const totalUnits = rows.reduce((sum, r) => sum + r.unitsSold, 0);
  const totalReturned = returnRows.reduce((sum, r) => sum + r.unitsReturned, 0);
  const top10 = rows.slice(0, 10);

  const siteEstadoMap = new Map<string, { receita: number; unidades: number }>();
  for (const r of siteCidades.rows) {
    const prev = siteEstadoMap.get(r.estado) ?? { receita: 0, unidades: 0 };
    siteEstadoMap.set(r.estado, { receita: prev.receita + r.receita, unidades: prev.unidades + r.unidades });
  }
  const siteEstadoRows = [...siteEstadoMap.entries()].map(([estado, v]) => ({ estado, ...v }));

  return (
    <div>
      <CollapsibleFilters>
        <FilterBar
          action="/dashboard/vendas"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          showTabelaPreco
          filters={filters}
        />
      </CollapsibleFilters>

      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Vendas ao longo do período</h2>
          <SalesTrendChart data={salesByDay} showRevenue={showFinancials} />
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Comparativo entre lojas</h2>
          <StoreCompareChart data={salesByDayPerStore.data} series={salesByDayPerStore.series} />
        </div>
      </section>

      {canSeeSiteMap && siteEstadoRows.length > 0 && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Mapa de vendas — Site</h2>
          <p className="mb-3 text-xs text-[var(--text-muted)]">
            Só o canal varejo do site (endereço de entrega). Lojas físicas não entram — a maior parte da venda avulsa não tem cidade cadastrada.
          </p>
          <BrazilMap rows={siteEstadoRows} />
        </section>
      )}

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
          Top {dimension === "grupo" ? "grupo" : dimension === "produto" ? "produto" : "tamanho"}{" "}
          {showFinancials ? "por receita bruta" : "por vendas brutas"}
        </h2>
        <TopBarChart data={top10} valueKey={showFinancials ? "revenue" : "unitsSold"} showCurrency={showFinancials} />
      </section>

      <DimensionToggle basePath="/dashboard/vendas" searchParams={rawParams} current={dimension} />

      <ExpandableSalesTable
        rows={rows}
        produtoRows={salesSubRows}
        tamanhoRows={salesTamanhoRows}
        totalUnits={totalUnits}
        showFinancials={showFinancials}
        parentLabel={dimension === "tamanho" ? "Tamanho" : dimension === "produto" ? "Produto" : "Grupo"}
        subLabel={dimension === "produto" ? "Tamanho" : "Produto"}
      />
      {/* ── Devoluções ── */}
      <h2 className="mb-3 mt-8 text-base font-semibold">Devoluções</h2>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Devoluções ao longo do período</h3>
        <ReturnsTrendChart data={returnsByDay} showValue={showFinancials} />
      </section>

      <ExpandableReturnsTable
        rows={returnRows}
        subRows={returnSubRows}
        tamanhoRows={returnTamanhoRows}
        totalReturned={totalReturned}
        showFinancials={showFinancials}
        parentLabel={dimension === "tamanho" ? "Tamanho" : dimension === "produto" ? "Produto" : "Grupo"}
      />
    </div>
  );
}
