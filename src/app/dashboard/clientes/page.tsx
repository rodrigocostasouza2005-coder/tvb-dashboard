import { getSessionUser } from "@/lib/auth";
import {
  getTopClientes, getStores, getMarcas, getTabelasPreco, getVendedores, getClienteRetencaoVarejo,
  getAniversariantesDoMes, getClientesCrmOverview, type Canal,
} from "@/lib/metrics";
import { canSeeFinancials, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, todayBrasiliaStr, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { waHref } from "@/lib/whatsapp";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { MetricBarChart } from "../metric-bar-chart";
import { StatTile } from "../stat-tile";
import { ClienteRetencaoChart } from "./cliente-retencao-chart";

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDataNascimento(d: Date | null) {
  if (!d) return null;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

function diaDoMes(d: Date) {
  return d.getUTCDate();
}

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "clientes");

  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const rawParams = await searchParams;
  const filtrosOpen = rawParams.filtros === "1";
  const filters = parseFilters(rawParams, {
    allowedStoreIds: allowedStores,
    allowedMarcas,
    allowedTabelasPreco,
  });
  const vendedor = typeof rawParams.vendedor === "string" && rawParams.vendedor ? rawParams.vendedor : null;
  const canal: Canal = rawParams.canal === "b2b" || rawParams.canal === "b2c" ? rawParams.canal : "todos";
  const aniversarioMesParsed = typeof rawParams.aniversarioMes === "string" ? parseInt(rawParams.aniversarioMes, 10) : NaN;
  const aniversarioMes = aniversarioMesParsed >= 1 && aniversarioMesParsed <= 12
    ? aniversarioMesParsed
    : parseInt(todayBrasiliaStr(new Date()).slice(5, 7), 10);

  const [rows, stores, marcas, tabelasPreco, vendedores, retencao, aniversariantes, overview] = await Promise.all([
    getTopClientes(filters, vendedor, 30, canal, true),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getVendedores(),
    getClienteRetencaoVarejo(filters),
    getAniversariantesDoMes(filters, vendedor, aniversarioMes),
    getClientesCrmOverview(filters, canal),
  ]);
  const showFinancials = canSeeFinancials(user);

  const exportAniversariantesParams = new URLSearchParams();
  for (const id of filters.storeIds ?? []) exportAniversariantesParams.append("store", id);
  for (const m of filters.marcas ?? []) exportAniversariantesParams.append("marca", m);
  for (const t of filters.tabelasPreco ?? []) exportAniversariantesParams.append("tabelaPreco", t);
  if (vendedor) exportAniversariantesParams.set("vendedor", vendedor);
  exportAniversariantesParams.set("aniversarioMes", String(aniversarioMes));

  function canalHref(c: Canal) {
    const p = new URLSearchParams();
    for (const id of filters.storeIds ?? []) p.append("store", id);
    for (const m of filters.marcas ?? []) p.append("marca", m);
    for (const t of filters.tabelasPreco ?? []) p.append("tabelaPreco", t);
    if (vendedor) p.set("vendedor", vendedor);
    p.set("canal", c);
    return `/dashboard/clientes?${p.toString()}`;
  }
  function clienteHref(nome: string) {
    const p = new URLSearchParams();
    for (const id of filters.storeIds ?? []) p.append("store", id);
    for (const m of filters.marcas ?? []) p.append("marca", m);
    for (const t of filters.tabelasPreco ?? []) p.append("tabelaPreco", t);
    p.set("cliente", nome);
    return `/dashboard/clientes-ficha?${p.toString()}`;
  }

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/clientes"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          showTabelaPreco
          filters={filters}
        />
      </CollapsibleFilters>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form method="get" action="/dashboard/clientes" className="flex flex-wrap items-center gap-2">
          {/* Preserva os filtros existentes ao filtrar por vendedor */}
          {filters.storeIds?.map((id) => <input key={id} type="hidden" name="store" value={id} />)}
          {filters.marcas?.map((m) => <input key={m} type="hidden" name="marca" value={m} />)}
          {filters.tabelasPreco?.map((t) => <input key={t} type="hidden" name="tabelaPreco" value={t} />)}
          <input type="hidden" name="canal" value={canal} />
          <label className="text-xs text-[var(--text-muted)]">Vendedor:</label>
          <select
            name="vendedor"
            defaultValue={vendedor ?? ""}
            className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm outline-none focus:border-[var(--series-1)] focus:ring-1 focus:ring-[var(--series-1)]"
          >
            <option value="">Todos</option>
            {vendedores.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          <button type="submit" className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm hover:bg-[var(--page-plane)]">
            Filtrar
          </button>
        </form>

        <div className="flex gap-1">
          {([
            { value: "todos", label: "Todos" },
            { value: "b2b", label: "B2B (atacado)" },
            { value: "b2c", label: "B2C (varejo)" },
          ] as const).map((opt) => (
            <a
              key={opt.value}
              href={canalHref(opt.value)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                canal === opt.value
                  ? "border-[var(--series-1)] bg-[var(--series-1)] text-white"
                  : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
              }`}
            >
              {opt.label}
            </a>
          ))}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Clientes ativos" value={overview.ativos.toLocaleString("pt-BR")} />
        <StatTile label="Novos" value={overview.novos.toLocaleString("pt-BR")} trend={overview.novos > 0 ? "up" : undefined} />
        <StatTile label="Recorrentes (2+ pedidos)" value={overview.recorrentes.toLocaleString("pt-BR")} />
        {showFinancials && <StatTile label="Ticket médio (líquido)" value={formatBRL(overview.ticketMedio)} />}
        {showFinancials && <StatTile label="Receita média/cliente (líquida)" value={formatBRL(overview.receitaMediaPorCliente)} />}
      </div>

      {showFinancials && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Top clientes por receita líquida</h2>
          <MetricBarChart
            data={rows.slice(0, 10).map((r) => ({ key: r.cliente, value: r.receitaLiquida }))}
            format="currency"
            color="var(--cat-3)"
          />
        </section>
      )}

      <div className="mb-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Contato</th>
              <th className="px-4 py-2 font-medium">Nascimento</th>
              <th className="px-4 py-2 font-medium">Pedidos</th>
              <th className="px-4 py-2 font-medium">Unidades</th>
              {showFinancials && <th className="px-4 py-2 font-medium">Receita líquida</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cliente} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                <td className="px-4 py-2 font-medium">
                  <a href={clienteHref(r.cliente)} className="hover:underline">{r.cliente}</a>
                </td>
                <td className="px-4 py-2">
                  {r.telefone ? (
                    <a href={waHref(r.telefone)} target="_blank" rel="noopener noreferrer" className="text-[var(--series-1)] hover:underline tabular-nums">
                      {r.telefone}
                    </a>
                  ) : (
                    <span className="text-[var(--text-muted)]">—</span>
                  )}
                  {r.email && <div className="text-xs text-[var(--text-muted)] mt-0.5">{r.email}</div>}
                </td>
                <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
                  {formatDataNascimento(r.dataNascimento) ?? <span className="text-[var(--text-muted)]">—</span>}
                </td>
                <td className="px-4 py-2 tabular-nums">{r.pedidos}</td>
                <td className="px-4 py-2 tabular-nums">{r.unidades}</td>
                {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(r.receitaLiquida)}</td>}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={showFinancials ? 6 : 5} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Sem vendas no período/filtro selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {retencao.months.length > 1 && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Retenção — novos vs recorrentes por mês</h2>
          <ClienteRetencaoChart data={retencao.months} />
        </section>
      )}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">
            Aniversariantes de {MONTH_NAMES[aniversarioMes - 1]} ({aniversariantes.length})
          </h2>
          <form method="get" action="/dashboard/clientes" className="flex items-center gap-2 text-sm">
            {filters.storeIds?.map((id) => <input key={id} type="hidden" name="store" value={id} />)}
            {filters.marcas?.map((m) => <input key={m} type="hidden" name="marca" value={m} />)}
            {filters.tabelasPreco?.map((t) => <input key={t} type="hidden" name="tabelaPreco" value={t} />)}
            {vendedor && <input type="hidden" name="vendedor" value={vendedor} />}
            <input type="hidden" name="canal" value={canal} />
            <select
              name="aniversarioMes"
              defaultValue={String(aniversarioMes)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 outline-none focus:border-[var(--series-1)] focus:ring-1 focus:ring-[var(--series-1)]"
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>{name}</option>
              ))}
            </select>
            <button type="submit" className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 hover:bg-[var(--page-plane)]">
              Ver
            </button>
          </form>
          <a
            href={`/api/export/aniversariantes?${exportAniversariantesParams.toString()}`}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
          >
            Exportar Excel
          </a>
        </div>

        {aniversariantes.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Ninguém com data de nascimento cadastrada nesse mês.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto overflow-x-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                  <th className="px-4 py-2 font-medium">Dia</th>
                  <th className="px-4 py-2 font-medium">Cliente</th>
                  <th className="px-4 py-2 font-medium">Contato</th>
                </tr>
              </thead>
              <tbody>
                {aniversariantes.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                    <td className="px-4 py-2 tabular-nums font-medium">{diaDoMes(c.dataNascimento)}</td>
                    <td className="px-4 py-2">{c.nome}</td>
                    <td className="px-4 py-2">
                      {c.telefone || c.celular ? (
                        <a href={waHref(c.telefone ?? c.celular ?? "")} target="_blank" rel="noopener noreferrer" className="text-[var(--series-1)] hover:underline tabular-nums">
                          {c.telefone ?? c.celular}
                        </a>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                      {c.email && <div className="text-xs text-[var(--text-muted)] mt-0.5">{c.email}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
