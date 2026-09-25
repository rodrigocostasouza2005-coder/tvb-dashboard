import { getSessionUser } from "@/lib/auth";
import {
  getTicketPorFaixaMensal,
  getTamanhoMixMensal,
  getStores,
  getMarcas,
  getTabelasPreco,
  getDistinctColecoes,
  getDistinctGrupos,
} from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestrictionSemAtacado } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { IndicatorChart } from "../indicadores/indicator-chart";

const FAIXA_COR = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)"];

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
  const allowedTabelasPreco = getTabelaPrecoRestrictionSemAtacado(user);
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
    </div>
  );
}
