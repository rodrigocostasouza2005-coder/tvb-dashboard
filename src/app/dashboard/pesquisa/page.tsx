import { getSessionUser } from "@/lib/auth";
import { searchStockVsSalesComTamanhos, getTopClientes, getDailySalesByProduto, getStores, getMarcas, getTabelasPreco, getDistinctColecoes } from "@/lib/metrics";
import { canSeeFinancials, getGrupoRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, brasiliaDayStart, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { IndicatorChart } from "../indicadores/indicator-chart";
import { PhoneLink } from "../phone-link";
import { PesquisaTable } from "./pesquisa-table";

const DATA_START_MONTH = "2025-09";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDataNascimento(d: Date | null) {
  if (!d) return null;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

export default async function PesquisaPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "pesquisa");

  const rawParams = await searchParams;
  const filtrosOpen = rawParams.filtros === "1";
  const query = typeof rawParams.q === "string" ? rawParams.q : "";
  const grupoIn = await getGrupoRestriction(user.role);
  // Pesquisa sempre libera todas as lojas, independente da restrição do usuário — pedido do
  // Rodrigo em 2026-09-03 (busca de produto/cliente precisa ver a base toda).
  const allowedStores = undefined;
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };
  const produtoSelecionado = typeof rawParams.produto === "string" && rawParams.produto ? rawParams.produto : null;
  // Visão do gráfico por produto — dia (padrão, como já era) ou mês, pedido do Rodrigo em
  // 2026-09-22. Não precisa de nova query: já busca o histórico inteiro dia a dia, mês é só
  // agrupar esses mesmos pontos.
  const visaoProduto = rawParams.visaoProduto === "mes" ? "mes" : "dia";
  const dataInicioRange = brasiliaDayStart(DATA_START_MONTH + "-01");
  const dataFimRange = new Date();

  const [{ rows, tamanhos }, clientes, stores, marcas, tabelasPreco, colecoes, produtoSerie] = await Promise.all([
    searchStockVsSalesComTamanhos(filters, query),
    query.trim() ? getTopClientes(filters, null, 20, "todos", true, query) : Promise.resolve([]),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getDistinctColecoes(),
    produtoSelecionado
      ? getDailySalesByProduto(
          { storeIds: filters.storeIds, marcas: filters.marcas, tabelasPreco: filters.tabelasPreco, grupoIn, from: dataInicioRange, to: dataFimRange },
          produtoSelecionado
        )
      : Promise.resolve([]),
  ]);
  const showFinancials = canSeeFinancials(user);

  const produtoChartDataDia = produtoSerie.map((p) => ({
    day: p.day,
    unitsBruta: p.unitsBruta,
    unitsLiquida: p.unitsLiquida,
    revenueBruta: p.revenueBruta,
    revenueLiquida: p.revenueLiquida,
  }));
  // Agrupa os mesmos pontos diários por "YYYY-MM" — mesmo formato que IndicatorChart já espera
  // pra granularity="month" (ver formatMonthShort).
  const produtoChartDataMes = (() => {
    const porMes = new Map<string, { month: string; unitsBruta: number; unitsLiquida: number; revenueBruta: number; revenueLiquida: number }>();
    for (const p of produtoSerie) {
      const month = p.day.slice(0, 7);
      const cur = porMes.get(month) ?? { month, unitsBruta: 0, unitsLiquida: 0, revenueBruta: 0, revenueLiquida: 0 };
      cur.unitsBruta += p.unitsBruta;
      cur.unitsLiquida += p.unitsLiquida;
      cur.revenueBruta += p.revenueBruta;
      cur.revenueLiquida += p.revenueLiquida;
      porMes.set(month, cur);
    }
    return [...porMes.values()].sort((a, b) => a.month.localeCompare(b.month));
  })();
  const produtoChartData = visaoProduto === "mes" ? produtoChartDataMes : produtoChartDataDia;

  const baseParams = new URLSearchParams();
  if (query) baseParams.set("q", query);
  for (const id of filters.storeIds ?? []) baseParams.append("store", id);
  for (const m of filters.marcas ?? []) baseParams.append("marca", m);
  for (const t of filters.tabelasPreco ?? []) baseParams.append("tabelaPreco", t);
  const produtoHrefBase = `/dashboard/pesquisa?${baseParams.toString()}`;
  const clearProdutoHref = produtoHrefBase;
  function visaoProdutoHref(v: "dia" | "mes") {
    const p = new URLSearchParams(baseParams);
    if (produtoSelecionado) p.set("produto", produtoSelecionado);
    if (v !== "dia") p.set("visaoProduto", v);
    return `/dashboard/pesquisa?${p.toString()}`;
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
          action="/dashboard/pesquisa"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          colecoes={colecoes}
          showTabelaPreco
          filters={filters}
        />
      </CollapsibleFilters>

      <form action="/dashboard/pesquisa" method="GET" className="mb-4 flex gap-2">
        {(filters.storeIds ?? []).map((id) => (
          <input key={id} type="hidden" name="store" value={id} />
        ))}
        {(filters.marcas ?? []).map((m) => (
          <input key={m} type="hidden" name="marca" value={m} />
        ))}
        {(filters.tabelasPreco ?? []).map((t) => (
          <input key={t} type="hidden" name="tabelaPreco" value={t} />
        ))}
        <div className="relative w-full max-w-sm">
          <svg
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--text-muted)]"
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <circle cx={11} cy={11} r={7} />
            <line x1={21} y1={21} x2={16.65} y2={16.65} />
          </svg>
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Buscar por nome..."
            className="w-full rounded-full border border-[var(--border)] bg-[var(--surface-1)] py-1.5 pr-3 pl-8 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--series-1)]"
            style={{ colorScheme: "light dark" }}
          />
        </div>
        <button
          type="submit"
          className="rounded-full bg-[var(--series-1)] px-4 py-1.5 text-sm font-medium text-white"
        >
          Buscar
        </button>
      </form>

      {clientes.length > 0 && (
        <div className="mb-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <h2 className="border-b border-[var(--gridline)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)]">
            Clientes encontrados
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Cliente</th>
                <th className="px-4 py-2 font-medium">Contato</th>
                <th className="px-4 py-2 font-medium">Nascimento</th>
                <th className="px-4 py-2 font-medium">Pedidos</th>
                <th className="px-4 py-2 font-medium">Unidades</th>
                {showFinancials && <th className="px-4 py-2 font-medium">Receita bruta</th>}
                {showFinancials && <th className="px-4 py-2 font-medium">Receita líquida</th>}
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.cliente} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium">
                    <a href={clienteHref(c.cliente)} className="hover:underline">{c.cliente}</a>
                  </td>
                  <td className="px-4 py-2">
                    {c.telefone ? (
                      <PhoneLink telefone={c.telefone} />
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                    {c.email && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{c.email}</div>}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
                    {formatDataNascimento(c.dataNascimento) ?? <span className="text-[var(--text-muted)]">—</span>}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{c.pedidos}</td>
                  <td className="px-4 py-2 tabular-nums">{c.unidades.toLocaleString("pt-BR")}</td>
                  {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(c.receitaBruta)}</td>}
                  {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(c.receitaLiquida)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {produtoSelecionado && (
        <div className="mb-6 flex flex-col gap-4 rounded-lg border border-[var(--series-1)] bg-[var(--surface-1)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-[var(--text-primary)]">{produtoSelecionado}</h2>
            <div className="flex items-center gap-2">
              <div className="flex overflow-hidden rounded-md border border-[var(--border)] text-xs">
                <a
                  href={visaoProdutoHref("dia")}
                  className={`px-2.5 py-1 ${visaoProduto === "dia" ? "bg-[var(--series-1)] text-white" : "text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"}`}
                >
                  Dia
                </a>
                <a
                  href={visaoProdutoHref("mes")}
                  className={`px-2.5 py-1 ${visaoProduto === "mes" ? "bg-[var(--series-1)] text-white" : "text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"}`}
                >
                  Mês
                </a>
              </div>
              <a href={clearProdutoHref} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
                Fechar
              </a>
            </div>
          </div>
          {showFinancials && (
            <section>
              <h3 className="mb-3 text-xs font-medium text-[var(--text-muted)]">Receita por {visaoProduto === "mes" ? "mês" : "dia"}</h3>
              <IndicatorChart
                data={produtoChartData}
                format="currency"
                granularity={visaoProduto === "mes" ? "month" : "day"}
                series={[
                  { key: "revenueBruta", name: "Bruta", color: "var(--series-1)" },
                  { key: "revenueLiquida", name: "Líquida", color: "var(--series-2)" },
                ]}
              />
            </section>
          )}
          <section>
            <h3 className="mb-3 text-xs font-medium text-[var(--text-muted)]">Unidades vendidas por {visaoProduto === "mes" ? "mês" : "dia"}</h3>
            <IndicatorChart
              data={produtoChartData}
              format="number"
              granularity={visaoProduto === "mes" ? "month" : "day"}
              series={[
                { key: "unitsBruta", name: "Brutas", color: "var(--series-1)" },
                { key: "unitsLiquida", name: "Líquidas", color: "var(--series-2)" },
              ]}
            />
          </section>
          {produtoChartData.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">Sem vendas desse produto no período/filtro.</p>
          )}
        </div>
      )}

      {/* Sem busca (catálogo inteiro) limita a 100 pra não travar a tela à toa — com busca
          (nome ou tamanho) mostra TODOS os resultados, mesmo que passe de 100 (achado em
          2026-09-02: buscar um tamanho comum tipo "30" bate em 100+ produtos, e cortar
          escondia parte do resultado real). */}
      <PesquisaTable
        produtoHrefBase={produtoHrefBase}
        rows={(query.trim() ? rows : rows.slice(0, 100)).map((r) => ({
          key: r.key,
          unitsSold: r.unitsSold,
          currentStock: r.currentStock,
          sellThroughRate: r.sellThroughRate,
          porTamanho: Object.fromEntries(r.porTamanho),
          porLoja: [...r.porLoja.entries()]
            .map(([loja, porTamanho]) => ({
              loja,
              porTamanho: Object.fromEntries(porTamanho),
              total: [...porTamanho.values()].reduce((sum, v) => sum + v, 0),
            }))
            .sort((a, b) => b.total - a.total),
        }))}
        tamanhos={tamanhos}
        emptyMessage={query ? "Nenhum resultado pra essa busca." : "Digite algo pra buscar."}
      />
    </div>
  );
}
