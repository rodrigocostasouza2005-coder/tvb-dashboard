import { getSessionUser } from "@/lib/auth";
import {
  getTopClientes, getStores, getMarcas, getTabelasPreco, getVendedores, getClienteRetencaoVarejo,
  getAniversariantesDoMes, getClientesCrmOverview, getClienteSegmentacao, getClientesPorDimensao,
  getClienteFicha, getSalesByDimension, type Canal, type ClienteSegmento,
} from "@/lib/metrics";
import { canSeeFinancials, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, todayBrasiliaStr, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { MetricBarChart } from "../metric-bar-chart";
import { StatTile } from "../stat-tile";
import { ClienteRetencaoChart } from "./cliente-retencao-chart";

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const SEGMENTO_ORDER: ClienteSegmento[] = ["vip", "recorrente", "em_risco", "novo", "ocasional", "inativo"];
const SEGMENTO_LABEL: Record<ClienteSegmento, string> = {
  vip: "VIP",
  recorrente: "Recorrentes",
  em_risco: "Em risco",
  novo: "Novos",
  ocasional: "Ocasionais",
  inativo: "Inativos",
};
const SEGMENTO_COR: Record<ClienteSegmento, string> = {
  vip: "var(--series-1)",
  recorrente: "var(--status-good)",
  em_risco: "var(--status-warning)",
  novo: "var(--cat-3)",
  ocasional: "var(--text-muted)",
  inativo: "var(--status-critical)",
};
const PRECO_LABEL: Record<string, string> = {
  full_price: "Preço cheio",
  promo_driven: "Guiado por promoção",
  mixed: "Misto",
  sem_dado: "Sem dado suficiente",
};

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDataNascimento(d: Date | null) {
  if (!d) return null;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

function formatData(d: Date) {
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

  const segmentoSelecionado = typeof rawParams.segmento === "string" ? (rawParams.segmento as ClienteSegmento) : null;
  const clienteFichaNome = typeof rawParams.cliente === "string" && rawParams.cliente ? rawParams.cliente : null;
  const pcDim: "produto" | "grupo" = rawParams.pcDim === "produto" ? "produto" : "grupo";
  const pcKey = typeof rawParams.pcKey === "string" && rawParams.pcKey ? rawParams.pcKey : null;

  const [
    rows, stores, marcas, tabelasPreco, vendedores, retencao, aniversariantes,
    overview, segmentacao, pcOptions, ficha,
  ] = await Promise.all([
    getTopClientes(filters, vendedor, 30, canal, true),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getVendedores(),
    getClienteRetencaoVarejo(filters),
    getAniversariantesDoMes(filters, vendedor, aniversarioMes),
    getClientesCrmOverview(filters, canal),
    getClienteSegmentacao(filters, canal),
    getSalesByDimension(filters, pcDim, canal),
    clienteFichaNome ? getClienteFicha(filters, clienteFichaNome) : Promise.resolve(null),
  ]);
  const showFinancials = canSeeFinancials(user);

  const pcResultado = pcKey ? await getClientesPorDimensao(filters, pcDim, pcKey, canal) : [];

  const segmentoCounts = new Map<ClienteSegmento, { count: number; receita: number }>();
  for (const s of segmentacao) {
    const cur = segmentoCounts.get(s.segmento) ?? { count: 0, receita: 0 };
    cur.count++;
    cur.receita += s.receitaBruta;
    segmentoCounts.set(s.segmento, cur);
  }
  const listaSegmento = segmentoSelecionado
    ? segmentacao
        .filter((s) => s.segmento === segmentoSelecionado)
        .sort((a, b) => b.receitaBruta - a.receitaBruta)
        .slice(0, 50)
    : [];

  const exportAniversariantesParams = new URLSearchParams();
  for (const id of filters.storeIds ?? []) exportAniversariantesParams.append("store", id);
  for (const m of filters.marcas ?? []) exportAniversariantesParams.append("marca", m);
  for (const t of filters.tabelasPreco ?? []) exportAniversariantesParams.append("tabelaPreco", t);
  if (vendedor) exportAniversariantesParams.set("vendedor", vendedor);
  exportAniversariantesParams.set("aniversarioMes", String(aniversarioMes));

  // Preserva os filtros atuais (loja/marca/tabela/vendedor/data/canal) em qualquer link novo
  // desta página — mesmo padrão já usado no resto do dashboard.
  const baseParams = () => {
    const p = new URLSearchParams();
    for (const id of filters.storeIds ?? []) p.append("store", id);
    for (const m of filters.marcas ?? []) p.append("marca", m);
    for (const t of filters.tabelasPreco ?? []) p.append("tabelaPreco", t);
    if (vendedor) p.set("vendedor", vendedor);
    if (typeof rawParams.from === "string" && rawParams.from) p.set("from", rawParams.from);
    if (typeof rawParams.to === "string" && rawParams.to) p.set("to", rawParams.to);
    p.set("canal", canal);
    return p;
  };

  function segmentoHref(seg: ClienteSegmento) {
    const p = baseParams();
    p.set("segmento", seg);
    return `/dashboard/clientes?${p.toString()}#segmentacao`;
  }
  function clienteHref(nome: string) {
    const p = baseParams();
    p.set("cliente", nome);
    return `/dashboard/clientes?${p.toString()}#ficha`;
  }
  function canalHref(c: Canal) {
    const p = baseParams();
    p.set("canal", c);
    return `/dashboard/clientes?${p.toString()}`;
  }
  function pcDimHref(dim: "produto" | "grupo") {
    const p = baseParams();
    p.set("pcDim", dim);
    return `/dashboard/clientes?${p.toString()}#produto-cliente`;
  }
  function pcKeyHref(key: string) {
    const p = baseParams();
    p.set("pcDim", pcDim);
    p.set("pcKey", key);
    return `/dashboard/clientes?${p.toString()}#produto-cliente`;
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

      {/* Visão geral */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Clientes ativos" value={overview.ativos.toLocaleString("pt-BR")} />
        <StatTile label="Novos" value={overview.novos.toLocaleString("pt-BR")} trend={overview.novos > 0 ? "up" : undefined} />
        <StatTile label="Recorrentes (2+ pedidos)" value={overview.recorrentes.toLocaleString("pt-BR")} />
        {showFinancials && <StatTile label="Ticket médio" value={formatBRL(overview.ticketMedio)} />}
        {showFinancials && <StatTile label="Receita média/cliente" value={formatBRL(overview.receitaMediaPorCliente)} />}
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
                    <a href={`tel:${r.telefone}`} className="text-[var(--series-1)] hover:underline tabular-nums">
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

      {/* Segmentação */}
      <section id="segmentacao" className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Segmentação de clientes</h2>
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          Baseado no histórico completo do cliente (não só no período do filtro acima) — loja/marca/tabela/canal continuam aplicados.
        </p>
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {SEGMENTO_ORDER.map((seg) => {
            const c = segmentoCounts.get(seg) ?? { count: 0, receita: 0 };
            return (
              <a
                key={seg}
                href={segmentoHref(seg)}
                className={`rounded-lg border p-3 text-left transition-colors hover:bg-[var(--page-plane)] ${
                  segmentoSelecionado === seg ? "border-[var(--series-1)]" : "border-[var(--border)]"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: SEGMENTO_COR[seg] }} />
                  <span className="text-xs font-medium text-[var(--text-secondary)]">{SEGMENTO_LABEL[seg]}</span>
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--text-primary)]">{c.count}</div>
                {showFinancials && (
                  <div className="mt-0.5 text-xs tabular-nums text-[var(--text-muted)]">{formatBRL(c.receita)}</div>
                )}
              </a>
            );
          })}
        </div>

        {segmentoSelecionado && (
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                  <th className="px-4 py-2 font-medium">Cliente ({SEGMENTO_LABEL[segmentoSelecionado]})</th>
                  <th className="px-4 py-2 font-medium">Pedidos</th>
                  <th className="px-4 py-2 font-medium">Última compra</th>
                  {showFinancials && <th className="px-4 py-2 font-medium">Receita bruta</th>}
                </tr>
              </thead>
              <tbody>
                {listaSegmento.map((s) => (
                  <tr key={s.cliente} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                    <td className="px-4 py-2 font-medium">
                      <a href={clienteHref(s.cliente)} className="hover:underline">{s.cliente}</a>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{s.pedidos}</td>
                    <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">há {s.recenciaDias}d</td>
                    {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(s.receitaBruta)}</td>}
                  </tr>
                ))}
                {listaSegmento.length === 0 && (
                  <tr>
                    <td colSpan={showFinancials ? 4 : 3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                      Nenhum cliente nesse segmento.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Ficha do cliente */}
      <section id="ficha" className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Ficha do cliente</h2>
        <form method="get" action="/dashboard/clientes#ficha" className="mb-4 flex gap-2">
          {filters.storeIds?.map((id) => <input key={id} type="hidden" name="store" value={id} />)}
          {filters.marcas?.map((m) => <input key={m} type="hidden" name="marca" value={m} />)}
          {filters.tabelasPreco?.map((t) => <input key={t} type="hidden" name="tabelaPreco" value={t} />)}
          <input type="hidden" name="canal" value={canal} />
          <input
            type="text"
            name="cliente"
            defaultValue={clienteFichaNome ?? ""}
            placeholder="Nome exato do cliente..."
            className="w-full max-w-sm rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--series-1)]"
            style={{ colorScheme: "light dark" }}
          />
          <button type="submit" className="rounded-md bg-[var(--series-1)] px-4 py-1.5 text-sm font-medium text-white">
            Ver ficha
          </button>
        </form>

        {clienteFichaNome && !ficha && (
          <p className="text-sm text-[var(--text-muted)]">Cliente não encontrado (confira o nome exato, ex: use um da lista acima).</p>
        )}

        {ficha && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[var(--text-primary)]">{ficha.cliente}</h3>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--text-secondary)]">
                  {ficha.telefone && (
                    <a href={`tel:${ficha.telefone}`} className="text-[var(--series-1)] hover:underline tabular-nums">{ficha.telefone}</a>
                  )}
                  {ficha.email && <span>{ficha.email}</span>}
                  {ficha.dataNascimento && <span>Nasc. {formatDataNascimento(ficha.dataNascimento)}</span>}
                </div>
              </div>
              <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
                {PRECO_LABEL[ficha.comportamentoPreco]}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {showFinancials && <StatTile label="Receita líquida (total)" value={formatBRL(ficha.receitaLiquida)} />}
              <StatTile label="Unidades (total)" value={ficha.unidades.toLocaleString("pt-BR")} />
              <StatTile label="Pedidos (total)" value={ficha.pedidos.toLocaleString("pt-BR")} />
              {showFinancials && <StatTile label="Ticket médio" value={formatBRL(ficha.ticketMedio)} />}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--text-muted)]">
              <span>1ª compra: {formatData(ficha.primeiraCompra)}</span>
              <span>Última compra: {formatData(ficha.ultimaCompra)}</span>
              {showFinancials && (
                <span>
                  B2B {formatBRL(ficha.receitaB2B)} · B2C {formatBRL(ficha.receitaB2C)}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <h4 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Produtos mais comprados</h4>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {ficha.topProdutos.map((p) => (
                    <li key={p.produto} className="flex items-center justify-between gap-2">
                      <span className="truncate text-[var(--text-primary)]">{p.produto}</span>
                      <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{p.unidades} un.</span>
                    </li>
                  ))}
                  {ficha.topProdutos.length === 0 && <li className="text-[var(--text-muted)]">—</li>}
                </ul>
              </div>
              <div>
                <h4 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Tamanhos mais comprados</h4>
                <ul className="flex flex-wrap gap-1.5">
                  {ficha.topTamanhos.map((t) => (
                    <li key={t.tamanho} className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)]">
                      {t.tamanho} <span className="text-[var(--text-muted)]">({t.unidades})</span>
                    </li>
                  ))}
                  {ficha.topTamanhos.length === 0 && <li className="text-[var(--text-muted)]">—</li>}
                </ul>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Produto/Grupo -> Clientes */}
      <section id="produto-cliente" className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Quem compra esse produto/grupo?</h2>
        <div className="mb-3 flex gap-1">
          <a
            href={pcDimHref("grupo")}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${pcDim === "grupo" ? "border-[var(--series-1)] bg-[var(--series-1)] text-white" : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"}`}
          >
            Por grupo
          </a>
          <a
            href={pcDimHref("produto")}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${pcDim === "produto" ? "border-[var(--series-1)] bg-[var(--series-1)] text-white" : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"}`}
          >
            Por produto
          </a>
        </div>
        <form method="get" action="/dashboard/clientes#produto-cliente" className="mb-4 flex gap-2">
          {filters.storeIds?.map((id) => <input key={id} type="hidden" name="store" value={id} />)}
          {filters.marcas?.map((m) => <input key={m} type="hidden" name="marca" value={m} />)}
          {filters.tabelasPreco?.map((t) => <input key={t} type="hidden" name="tabelaPreco" value={t} />)}
          <input type="hidden" name="canal" value={canal} />
          <input type="hidden" name="pcDim" value={pcDim} />
          <select
            name="pcKey"
            defaultValue={pcKey ?? ""}
            className="w-full max-w-sm rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
            style={{ colorScheme: "light dark" }}
          >
            <option value="">Selecione um {pcDim}...</option>
            {pcOptions.map((o) => (
              <option key={o.key} value={o.key}>{o.key}</option>
            ))}
          </select>
          <button type="submit" className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm hover:bg-[var(--page-plane)]">
            Ver
          </button>
        </form>

        {pcKey && (
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                  <th className="px-4 py-2 font-medium">Cliente</th>
                  <th className="px-4 py-2 font-medium">Unidades</th>
                  {showFinancials && <th className="px-4 py-2 font-medium">Receita bruta</th>}
                </tr>
              </thead>
              <tbody>
                {pcResultado.map((r) => (
                  <tr key={r.cliente} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                    <td className="px-4 py-2 font-medium">
                      <a href={clienteHref(r.cliente)} className="hover:underline">{r.cliente}</a>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{r.unidades}</td>
                    {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(r.receita)}</td>}
                  </tr>
                ))}
                {pcResultado.length === 0 && (
                  <tr>
                    <td colSpan={showFinancials ? 3 : 2} className="px-4 py-6 text-center text-[var(--text-muted)]">
                      Sem clientes identificados pra esse {pcDim} no período/filtro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
                        <a href={`tel:${c.telefone ?? c.celular}`} className="text-[var(--series-1)] hover:underline tabular-nums">
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
