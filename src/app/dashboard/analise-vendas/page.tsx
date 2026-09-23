import { getSessionUser } from "@/lib/auth";
import {
  getTicketPorFaixaMensal,
  getTamanhoMixMensal,
  getMonthlySalesByGrupo,
  getStores,
  getMarcas,
  getTabelasPreco,
  getDistinctColecoes,
  getDistinctGrupos,
  type DashboardFilters,
} from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { IndicatorChart } from "../indicadores/indicator-chart";

const FAIXA_COR = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)"];
const FAMILIA_COR = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)", "var(--cat-7)", "var(--cat-8)"];

export default async function AnaliseVendasPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "analise-vendas");

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

  const [ticket, stores, marcas, tabelasPreco, colecoes, todosGrupos] = await Promise.all([
    getTicketPorFaixaMensal(filters),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getDistinctColecoes(),
    getDistinctGrupos(),
  ]);

  const opcoesGrupo = grupoIn ? todosGrupos.filter((g) => grupoIn.includes(g)) : todosGrupos;
  const grupoParam = typeof rawParams.grupo === "string" && rawParams.grupo ? rawParams.grupo : null;
  const grupoSelecionado = grupoParam && opcoesGrupo.includes(grupoParam) ? grupoParam : (opcoesGrupo[0] ?? null);
  const tamanho = grupoSelecionado ? await getTamanhoMixMensal(filters, grupoSelecionado) : null;

  // Vendas mensais por Família: histórico completo, mesmo espírito das 2 seções acima nesta
  // página (não segue o filtro de data, que nem aparece aqui — showDate={false}).
  const historicoFilters: DashboardFilters = { ...filters, from: new Date("2020-01-01"), to: new Date() };
  const porFamilia = await getMonthlySalesByGrupo(historicoFilters);

  const visaoFamilia = rawParams.visaoFamilia === "qtd" ? "qtd" : "faturamento";
  const totalPorFamilia = new Map(
    porFamilia.series.map((f) => [
      f,
      porFamilia.data.reduce((s, d) => s + (visaoFamilia === "qtd" ? (d.units[f] ?? 0) : (d.revenue[f] ?? 0)), 0),
    ])
  );
  const top5Familias = [...porFamilia.series].sort((a, b) => (totalPorFamilia.get(b) ?? 0) - (totalPorFamilia.get(a) ?? 0)).slice(0, 5);
  const familiaParam = rawParams.familia;
  const familiaSelecionadaParam = Array.isArray(familiaParam) ? familiaParam : typeof familiaParam === "string" ? [familiaParam] : undefined;
  const familiasSelecionadas = (familiaSelecionadaParam ?? top5Familias).filter((f) => porFamilia.series.includes(f));

  function visaoFamiliaHref(v: "faturamento" | "qtd") {
    const p = new URLSearchParams();
    for (const id of filters.storeIds ?? []) p.append("store", id);
    for (const m of filters.marcas ?? []) p.append("marca", m);
    for (const t of filters.tabelasPreco ?? []) p.append("tabelaPreco", t);
    for (const c of filters.colecaoIn ?? []) p.append("colecao", c);
    if (grupoSelecionado) p.set("grupo", grupoSelecionado);
    for (const f of familiasSelecionadas) p.append("familia", f);
    p.set("visaoFamilia", v);
    return `/dashboard/analise-vendas?${p.toString()}#familia`;
  }

  const chartDataFamilia = porFamilia.data.map((d) => {
    const point: Record<string, string | number> = { month: d.month };
    for (const f of familiasSelecionadas) point[f] = (visaoFamilia === "qtd" ? d.units[f] : d.revenue[f]) ?? 0;
    return point;
  });

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/analise-vendas"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          colecoes={colecoes}
          showTabelaPreco
          showDate={false}
          filters={filters}
        />
      </CollapsibleFilters>

      <h2 className="mb-1 text-base font-semibold">Ticket por faixa de valor</h2>
      <p className="mb-4 text-xs text-[var(--text-muted)]">
        Quantidade de pedidos por faixa de valor, por loja e por mês (histórico completo — não segue o
        filtro de data acima, igual a aba Indicadores no Tempo).
      </p>

      <div className="mb-8 flex flex-col gap-6">
        {ticket.rows.map((r) => (
          <section
            key={r.storeName}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4"
          >
            <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">{r.storeName}</h3>
            <IndicatorChart
              data={ticket.months.map((m, i) => {
                const point: Record<string, string | number> = { month: m };
                for (const f of r.faixas) point[f.label] = f.counts[i];
                return point;
              })}
              format="number"
              series={r.faixas.map((f, i) => ({ key: f.label, name: f.label, color: FAIXA_COR[i % FAIXA_COR.length] }))}
            />
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                    <th className="px-3 py-1.5 font-medium">Faixa</th>
                    {ticket.months.map((m) => (
                      <th key={m} className="px-3 py-1.5 text-right font-medium">{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.faixas.map((f) => (
                    <tr key={f.label} className="border-b border-[var(--gridline)] last:border-0">
                      <td className="px-3 py-1.5 font-medium text-[var(--text-primary)]">{f.label}</td>
                      {f.counts.map((c, i) => (
                        <td key={ticket.months[i]} className="px-3 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">
                          {c.toLocaleString("pt-BR")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {ticket.rows.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">Sem pedidos suficientes no filtro selecionado.</p>
        )}
      </div>

      <h2 className="mb-1 text-base font-semibold">Mix de tamanho por grupo</h2>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        % do vendido daquele grupo, em cada mês, que veio de cada tamanho (histórico completo, mesma
        lógica de período da seção acima).
      </p>

      <form method="GET" action="/dashboard/analise-vendas" className="mb-4 flex items-center gap-2">
        {(filters.storeIds ?? []).map((id) => <input key={id} type="hidden" name="store" value={id} />)}
        {(filters.marcas ?? []).map((m) => <input key={m} type="hidden" name="marca" value={m} />)}
        {(filters.tabelasPreco ?? []).map((t) => <input key={t} type="hidden" name="tabelaPreco" value={t} />)}
        {(filters.colecaoIn ?? []).map((c) => <input key={c} type="hidden" name="colecao" value={c} />)}
        <label className="text-xs text-[var(--text-muted)]">Grupo:</label>
        <select
          name="grupo"
          defaultValue={grupoSelecionado ?? ""}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
          style={{ colorScheme: "light dark" }}
        >
          {opcoesGrupo.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <button type="submit" className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm hover:bg-[var(--page-plane)]">
          Ver
        </button>
      </form>

      {tamanho && tamanho.rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Tamanho</th>
                {tamanho.months.map((m) => (
                  <th key={m} className="px-4 py-2 text-right font-medium">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tamanho.rows.map((r) => (
                <tr key={r.tamanho} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{r.tamanho}</td>
                  {r.pct.map((v, i) => (
                    <td key={tamanho.months[i]} className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                      {v > 0 ? `${v.toFixed(1)}%` : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">Sem vendas desse grupo no filtro selecionado.</p>
      )}

      <h2 id="familia" className="mt-8 mb-1 text-base font-semibold">Vendas mensais por família</h2>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Evolução mês a mês por família de produto (histórico completo, mesma lógica de período das seções acima) —
        pra identificar crescimento, queda ou concentração de vendas numa família.
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
        <form method="GET" action="/dashboard/analise-vendas#familia" className="flex flex-wrap items-center gap-2">
          {(filters.storeIds ?? []).map((id) => <input key={id} type="hidden" name="store" value={id} />)}
          {(filters.marcas ?? []).map((m) => <input key={m} type="hidden" name="marca" value={m} />)}
          {(filters.tabelasPreco ?? []).map((t) => <input key={t} type="hidden" name="tabelaPreco" value={t} />)}
          {(filters.colecaoIn ?? []).map((c) => <input key={c} type="hidden" name="colecao" value={c} />)}
          {grupoSelecionado && <input type="hidden" name="grupo" value={grupoSelecionado} />}
          <input type="hidden" name="visaoFamilia" value={visaoFamilia} />
          {porFamilia.series.map((f) => (
            <label key={f} className="cursor-pointer">
              <input type="checkbox" name="familia" value={f} defaultChecked={familiasSelecionadas.includes(f)} className="peer sr-only" />
              <span className="inline-block rounded-full border border-[var(--border)] bg-[var(--page-plane)] px-3 py-1 text-xs text-[var(--text-secondary)] transition-colors peer-checked:border-[var(--series-1)] peer-checked:bg-[var(--series-1)] peer-checked:text-white">
                {f}
              </span>
            </label>
          ))}
          <button type="submit" className="rounded-md bg-[var(--series-1)] px-3 py-1.5 text-xs font-medium text-white">
            Comparar
          </button>
        </form>

        <div className="flex overflow-hidden rounded-md border border-[var(--border)] text-xs">
          <a
            href={visaoFamiliaHref("faturamento")}
            className={`px-3 py-1.5 ${visaoFamilia === "faturamento" ? "bg-[var(--series-1)] text-white" : "text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"}`}
          >
            Faturamento
          </a>
          <a
            href={visaoFamiliaHref("qtd")}
            className={`px-3 py-1.5 ${visaoFamilia === "qtd" ? "bg-[var(--series-1)] text-white" : "text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"}`}
          >
            Quantidade
          </a>
        </div>
      </div>

      {familiasSelecionadas.length > 0 && chartDataFamilia.length > 0 ? (
        <>
          <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <IndicatorChart
              data={chartDataFamilia}
              format={visaoFamilia === "qtd" ? "number" : "currency"}
              series={familiasSelecionadas.map((f, i) => ({ key: f, name: f, color: FAMILIA_COR[i % FAMILIA_COR.length] }))}
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                  <th className="px-4 py-2 font-medium">Família</th>
                  {porFamilia.data.map((d) => (
                    <th key={d.month} className="px-4 py-2 text-right font-medium">{d.month}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {familiasSelecionadas.map((f) => (
                  <tr key={f} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                    <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{f}</td>
                    {porFamilia.data.map((d) => {
                      const v = (visaoFamilia === "qtd" ? d.units[f] : d.revenue[f]) ?? 0;
                      return (
                        <td key={d.month} className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                          {v > 0
                            ? visaoFamilia === "qtd"
                              ? v.toLocaleString("pt-BR")
                              : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
                            : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">Sem família com vendas suficientes no filtro selecionado.</p>
      )}
    </div>
  );
}
