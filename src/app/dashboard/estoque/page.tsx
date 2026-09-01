import { getSessionUser } from "@/lib/auth";
import { getStockVsSalesCombinado, getTotalStock, getDistinctGrupos, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, toArray, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { StatTile } from "../stat-tile";
import { EstoqueVendasDinamico } from "./estoque-vendas-dinamico";
import { GrupoFilterSelect } from "./grupo-filter-select";

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
  const grupoPermitido = await getGrupoRestriction(user.role);
  // Filtro de grupo escolhido pelo usuário (multi-seleção) — pedido do Rodrigo em 2026-09-01.
  // Cruza com a restrição de permissão (quando existe, ex: VENDEDOR só vê os grupos prioritários)
  // pra nunca ampliar além do que o cargo já permite, só restringir mais.
  const grupoSelecionado = toArray(rawParams.grupo);
  const grupoIn =
    grupoSelecionado.length > 0
      ? grupoPermitido
        ? grupoPermitido.filter((g) => grupoSelecionado.includes(g))
        : grupoSelecionado
      : grupoPermitido;
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  const [rows, totalEstoque, stores, marcas, tabelasPreco, todosGrupos] = await Promise.all([
    getStockVsSalesCombinado(filters),
    getTotalStock({ storeIds: filters.storeIds, grupoIn: filters.grupoIn }),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getDistinctGrupos(),
  ]);
  const totalVendido = rows.reduce((sum, r) => sum + r.unitsSold, 0);
  const opcoesGrupo = grupoPermitido ? todosGrupos.filter((g) => grupoPermitido.includes(g)) : todosGrupos;

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

      <GrupoFilterSelect options={opcoesGrupo} current={grupoSelecionado} />

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile label="Estoque atual (total)" value={totalEstoque.toLocaleString("pt-BR")} />
        <StatTile label="Vendido no período (líquido) (total)" value={totalVendido.toLocaleString("pt-BR")} />
      </section>

      <EstoqueVendasDinamico rows={rows} />
    </div>
  );
}
