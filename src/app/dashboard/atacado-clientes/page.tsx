import { getSessionUser } from "@/lib/auth";
import { getAtacadoClientes, getClienteRetencaoPorMes, getCmvPorCliente, getDistinctColecoes } from "@/lib/metrics";
import {
  canSeeFinancials,
  getGrupoRestriction,
  getStoreRestriction,
  getMarcaRestriction,
  getTabelaPrecoRestriction,
} from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { StatTile } from "../stat-tile";
import { ClientesTable } from "./clientes-table";
import { ClienteRetencaoChart } from "./cliente-retencao-chart";

export default async function AtacadoClientesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "atacado-clientes");
  const filtrosOpen = (await searchParams).filtros === "1";

  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(await searchParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };
  const showFinancials = canSeeFinancials(user);

  const clienteFichaParams = new URLSearchParams();
  for (const id of filters.storeIds ?? []) clienteFichaParams.append("store", id);
  for (const m of filters.marcas ?? []) clienteFichaParams.append("marca", m);
  for (const t of filters.tabelasPreco ?? []) clienteFichaParams.append("tabelaPreco", t);

  const [data, retencao, colecoes, cmvPorCliente] = await Promise.all([
    getAtacadoClientes(filters),
    getClienteRetencaoPorMes(filters),
    getDistinctColecoes(),
    getCmvPorCliente(filters),
  ]);

  // CMV estimado (custo unitário ATUAL × unidades BRUTAS — mesma limitação de "bruta = líquida"
  // de toda esta página: Return não tem clienteNome no schema, não dá pra descontar devolução
  // por cliente). Junta por clienteNome, mesmo universo/filtro de getAtacadoClientes (mesma
  // chamada de canalWhere("b2b") por baixo).
  const cmvByCliente = new Map(cmvPorCliente.map((c) => [c.key, c]));
  const rowsComCmv = data.rows.map((r) => {
    const cmvInfo = cmvByCliente.get(r.clienteNome);
    const cmv = cmvInfo?.cmv ?? 0;
    const lucroBruto = r.receita - cmv;
    const margemPct = r.receita > 0 ? (lucroBruto / r.receita) * 100 : null;
    return { ...r, cmv, lucroBruto, margemPct, unidadesSemCusto: cmvInfo?.unidadesSemCusto ?? 0 };
  });

  const totalReceita = data.rows.reduce((sum, r) => sum + r.receita, 0);
  const totalCmv = rowsComCmv.reduce((sum, r) => sum + r.cmv, 0);
  const totalLucroBruto = totalReceita - totalCmv;
  const margemTotalPct = totalReceita > 0 ? (totalLucroBruto / totalReceita) * 100 : null;

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/atacado-clientes"
          stores={[]}
          marcas={[]}
          tabelasPreco={[]}
          colecoes={colecoes}
          showMarca={false}
          showDate
          filters={filters}
        />
      </CollapsibleFilters>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Clientes únicos" value={String(data.totalClientes)} />
        <StatTile
          label="Novos no período"
          value={String(data.novosNoPeriodo)}
          status={data.novosNoPeriodo > 0 ? "good" : undefined}
          trend={data.novosNoPeriodo > 0 ? "up" : undefined}
        />
        {showFinancials && (
          <StatTile
            label="Total Receita bruta"
            value={totalReceita.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          />
        )}
        {showFinancials && (
          <StatTile
            label="CMV estimado"
            value={totalCmv.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          />
        )}
        {showFinancials && (
          <StatTile
            label="Lucro bruto"
            value={totalLucroBruto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          />
        )}
        {showFinancials && (
          <StatTile
            label="Margem bruta"
            value={margemTotalPct === null ? "—" : `${margemTotalPct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
          />
        )}
        <StatTile label="Compraram 1x" value={String(retencao.compraram1x)} />
        <StatTile
          label="Compraram +1x"
          value={String(retencao.compraramMaisde1x)}
          trend={retencao.compraramMaisde1x > 0 ? "up" : undefined}
        />
      </div>

      {retencao.months.length > 1 && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Retenção — novos vs recorrentes por mês</h2>
          <ClienteRetencaoChart data={retencao.months} />
        </section>
      )}

      {showFinancials && (
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          CMV estimado: custo unitário ATUAL (StockSnapshot) × unidades brutas vendidas por cliente — sem desconto de devolução (Return não tem o nome do cliente no schema, mesma limitação de &quot;Receita bruta&quot; nesta página). Não é CMV contábil.
        </p>
      )}
      <ClientesTable rows={rowsComCmv} showReceita={showFinancials} filtrosQuery={clienteFichaParams.toString()} />
    </div>
  );
}
