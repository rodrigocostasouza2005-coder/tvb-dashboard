import { getSessionUser } from "@/lib/auth";
import { getAtacadoVendas, getAtacadoClienteNomes, getAtacadoClienteEvolucao, getDistinctColecoes } from "@/lib/metrics";
import {
  canSeeFinancials,
  getGrupoRestriction,
  getStoreRestriction,
  getMarcaRestriction,
  getTabelaPrecoRestriction,
} from "@/lib/permissions";
import { parseFilters, toDateInputValue, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { StatTile } from "../stat-tile";
import { IndicatorChart } from "../indicadores/indicator-chart";
import { AtacadoTrendChart } from "./atacado-trend-chart";
import { AtacadoGruposChart } from "./atacado-grupos-chart";
import { AtacadoProdutosTable } from "./atacado-produtos-table";
import { AtacadoClienteProdutosTable } from "./atacado-cliente-produtos-table";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function AtacadoPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "atacado");
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
  const showFinancials = canSeeFinancials(user);

  // Filtro de Cliente (2026-09-18): selecionar um cliente troca a página inteira pra visão de
  // evolução daquele cliente (ano atual vs ano anterior); sem seleção, mantém a visão geral de
  // sempre. "Todos os clientes" = valor vazio, mesmo padrão do filtro de Vendedor em
  // dashboard/clientes.
  const clienteSelecionado = typeof rawParams.cliente === "string" && rawParams.cliente ? rawParams.cliente : null;

  const [colecoes, clientesAtacado] = await Promise.all([getDistinctColecoes(), getAtacadoClienteNomes()]);

  const evolucao = clienteSelecionado ? await getAtacadoClienteEvolucao(clienteSelecionado, filters) : null;

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/atacado"
          stores={[]}
          marcas={[]}
          tabelasPreco={[]}
          colecoes={colecoes}
          showMarca={false}
          showDate
          filters={filters}
          extraParams={clienteSelecionado ? { cliente: clienteSelecionado } : undefined}
        />
      </CollapsibleFilters>

      <form method="GET" action="/dashboard/atacado" className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        {/* Preserva os filtros de data/coleção existentes ao trocar de cliente. */}
        <input type="hidden" name="from" value={toDateInputValue(filters.from)} />
        <input type="hidden" name="to" value={toDateInputValue(filters.to)} />
        {filters.colecaoIn?.map((c) => <input key={c} type="hidden" name="colecao" value={c} />)}
        <label className="text-xs text-[var(--text-muted)]">Cliente:</label>
        <select
          name="cliente"
          defaultValue={clienteSelecionado ?? ""}
          className="min-w-[220px] rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--series-1)] focus:ring-1 focus:ring-[var(--series-1)]"
          style={{ colorScheme: "light dark" }}
        >
          <option value="">Todos os clientes</option>
          {clientesAtacado.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button type="submit" className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm hover:bg-[var(--page-plane)]">
          Filtrar
        </button>
      </form>

      {clienteSelecionado ? (
        evolucao ? (
          <div>
            <p className="mb-4 text-sm text-[var(--text-secondary)]">
              Evolução de <strong className="text-[var(--text-primary)]">{evolucao.cliente}</strong> — {evolucao.anoAnterior} vs {evolucao.anoAtual}, ambos {evolucao.cortePeriodo} (mesmo período nos dois anos, pra não comparar ano parcial com ano inteiro).
              O histórico real de vendas do Radar começa em setembro/2025 — meses antes disso aparecem zerados por falta de sincronização, não por falta de venda.
            </p>

            {showFinancials && (
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile
                  label={`Vendas em ${evolucao.anoAtual}`}
                  value={formatBRL(evolucao.totalAtual.receita)}
                  subValue={`${evolucao.totalAtual.pedidos} pedidos`}
                />
                <StatTile
                  label={`Vendas em ${evolucao.anoAnterior}`}
                  value={formatBRL(evolucao.totalAnterior.receita)}
                  subValue={`${evolucao.totalAnterior.pedidos} pedidos`}
                />
                <StatTile
                  label="Variação em R$"
                  value={`${evolucao.variacaoReais >= 0 ? "+" : ""}${formatBRL(evolucao.variacaoReais)}`}
                  trend={evolucao.variacaoReais >= 0 ? "up" : "down"}
                />
                <StatTile
                  label="Variação %"
                  value={
                    evolucao.variacaoPercent === null
                      ? evolucao.totalAtual.receita > 0 ? "Novo" : "—"
                      : `${evolucao.variacaoPercent >= 0 ? "+" : ""}${evolucao.variacaoPercent.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
                  }
                  trend={evolucao.variacaoPercent === null ? undefined : evolucao.variacaoPercent >= 0 ? "up" : "down"}
                />
              </div>
            )}

            {showFinancials && (
              <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
                <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Evolução mês a mês</h2>
                <IndicatorChart
                  data={evolucao.meses.map((m) => ({
                    mes: String(m.mes).padStart(2, "0"),
                    receitaAnterior: m.receitaAnterior,
                    receitaAtual: m.receitaAtual,
                  }))}
                  series={[
                    { key: "receitaAnterior", name: String(evolucao.anoAnterior), color: "var(--series-2)" },
                    { key: "receitaAtual", name: String(evolucao.anoAtual), color: "var(--series-1)" },
                  ]}
                  format="currency"
                  granularity="monthOfYear"
                />
              </section>
            )}

            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
              <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Produtos comprados</h2>
              <AtacadoClienteProdutosTable
                rows={evolucao.produtos.map((p) => ({ ...p, ultimaCompra: p.ultimaCompra.toISOString() }))}
                anoAtual={evolucao.anoAtual}
                anoAnterior={evolucao.anoAnterior}
                showReceita={showFinancials}
              />
            </section>
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">Nenhuma venda encontrada pra esse cliente no período disponível.</p>
        )
      ) : (
        <AtacadoVisaoGeral filters={filters} showFinancials={showFinancials} />
      )}
    </div>
  );
}

// Visão consolidada de sempre — inalterada, só extraída pra função própria pra não misturar
// com o modo "cliente selecionado" acima.
async function AtacadoVisaoGeral({
  filters,
  showFinancials,
}: {
  filters: Parameters<typeof getAtacadoVendas>[0];
  showFinancials: boolean;
}) {
  // getAtacadoVendas já filtra só B2B por dentro (canalWhere("b2b"), cliente-level).
  const { kpis, byDay, topProdutos } = await getAtacadoVendas(filters);

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {showFinancials && (
          <StatTile
            label="Receita bruta"
            value={kpis.receita.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          />
        )}
        <StatTile label="Pedidos" value={kpis.pedidos.toLocaleString("pt-BR")} />
        <StatTile label="Unidades brutas" value={kpis.unidades.toLocaleString("pt-BR")} />
        {showFinancials && (
          <StatTile
            label="Ticket Médio"
            value={kpis.ticketMedio.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          />
        )}
      </div>

      {showFinancials && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Receita bruta por dia</h2>
          <AtacadoTrendChart data={byDay} />
        </section>
      )}

      {showFinancials && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Receita bruta por grupo (top 12)</h2>
          <AtacadoGruposChart rows={topProdutos} />
        </section>
      )}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Detalhe por grupo e produto</h2>
        <AtacadoProdutosTable rows={topProdutos} showReceita={showFinancials} />
      </section>
    </>
  );
}
