import { getSessionUser } from "@/lib/auth";
import {
  getStockVsSalesCombinado,
  getTotalStock,
  getDistinctGrupos,
  getDistinctTamanhos,
  getDistinctColecoes,
  getStores,
  getMarcas,
  getTabelasPreco,
} from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, toArray, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { StatTile } from "../stat-tile";
import { EstoqueVendasDinamico } from "./estoque-vendas-dinamico";
import { MultiSelectFilter } from "./multi-select-filter";

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
  // Filtros escolhidos pelo usuário (multi-seleção) — pedido do Rodrigo em 2026-09-01. Grupo
  // cruza com a restrição de permissão (VENDEDOR só vê os grupos prioritários) pra nunca ampliar
  // além do que o cargo já permite, só restringir mais. Tamanho/Coleção não têm restrição de
  // permissão hoje, então vão direto.
  const grupoSelecionado = toArray(rawParams.grupo);
  const grupoIn =
    grupoSelecionado.length > 0
      ? grupoPermitido
        ? grupoPermitido.filter((g) => grupoSelecionado.includes(g))
        : grupoSelecionado
      : grupoPermitido;
  const tamanhoSelecionado = toArray(rawParams.tamanho);
  const colecaoSelecionada = toArray(rawParams.colecao);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
    tamanhoIn: tamanhoSelecionado.length > 0 ? tamanhoSelecionado : undefined,
    colecaoIn: colecaoSelecionada.length > 0 ? colecaoSelecionada : undefined,
  };

  const [rows, totalEstoque, stores, marcas, tabelasPreco, todosGrupos, todosTamanhos, todasColecoes] = await Promise.all([
    getStockVsSalesCombinado(filters),
    getTotalStock({ storeIds: filters.storeIds, grupoIn: filters.grupoIn, tamanhoIn: filters.tamanhoIn, colecaoIn: filters.colecaoIn }),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getDistinctGrupos(),
    getDistinctTamanhos(),
    getDistinctColecoes(),
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

      <div className="flex flex-wrap gap-4">
        <MultiSelectFilter paramName="grupo" label="Grupo de produto" placeholder="Todos os grupos" options={opcoesGrupo} current={grupoSelecionado} />
        <MultiSelectFilter paramName="tamanho" label="Tamanho" placeholder="Todos os tamanhos" options={todosTamanhos} current={tamanhoSelecionado} />
        <MultiSelectFilter paramName="colecao" label="Coleção" placeholder="Todas as coleções" options={todasColecoes} current={colecaoSelecionada} />
      </div>

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile label="Estoque atual (total)" value={totalEstoque.toLocaleString("pt-BR")} />
        <StatTile label="Vendido no período (líquido) (total)" value={totalVendido.toLocaleString("pt-BR")} />
      </section>

      <EstoqueVendasDinamico rows={rows} />
    </div>
  );
}
