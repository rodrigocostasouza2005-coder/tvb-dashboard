import { getSessionUser } from "@/lib/auth";
import { getReplenishment, getReplenishmentPorVendas, getStores, getMarcas, getDistinctColecoes } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { parseFilters, toDateInputValue, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { MetricBarChart } from "../metric-bar-chart";
import { ModoToggle, parseReplenishmentModo } from "./modo-toggle";

export default async function ReposicaoPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "reposicao");

  const rawParams = await searchParams;
  const filtrosOpen = rawParams.filtros === "1";
  const modo = parseReplenishmentModo(rawParams);
  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores }),
    grupoIn,
  };

  // Modo "Estoque Mínimo" continua chamando exatamente a mesma função de sempre
  // (getReplenishment), sem nenhuma alteração de comportamento. "Vendas" é um cálculo à parte
  // (getReplenishmentPorVendas) — ver lib/metrics.ts. getReplenishmentPorVendas já devolve só o
  // que precisa ser reposto (vendeu mais na semana passada do que tem disponível agora).
  const [rowsMinimo, rowsVendas, stores, marcas, colecoes] = await Promise.all([
    modo === "minimo" ? getReplenishment(filters) : Promise.resolve([]),
    modo === "vendas" ? getReplenishmentPorVendas(filters) : Promise.resolve([]),
    getStores(allowedStores),
    getMarcas(),
    getDistinctColecoes(),
  ]);

  const exportParams = new URLSearchParams();
  for (const id of filters.storeIds ?? []) exportParams.append("store", id);
  for (const c of filters.colecaoIn ?? []) exportParams.append("colecao", c);
  exportParams.set("from", toDateInputValue(filters.from));
  exportParams.set("to", toDateInputValue(filters.to));
  exportParams.set("modo", modo);

  const rows = modo === "minimo" ? rowsMinimo : rowsVendas;

  return (
    <div>
      <ModoToggle basePath="/dashboard/reposicao" searchParams={rawParams} current={modo} />

      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/reposicao"
          stores={stores}
          marcas={marcas}
          colecoes={colecoes}
          filters={filters}
          showMarca={false}
          showDate={false}
          extraParams={{ modo }}
        />
      </CollapsibleFilters>

      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">
          {modo === "minimo" ? (
            <>
              Mostra itens com estoque abaixo do mínimo e com estoque disponível na origem pra
              repor de verdade — o que está abaixo do mínimo mas sem nada pra puxar não aparece aqui.
            </>
          ) : (
            <>
              Cruza a venda da semana anterior com o estoque disponível agora — só aparece quem
              vendeu mais na semana passada do que tem disponível. Exceção: quem zerou e não teve
              nenhuma venda na semana (sem estoque pra vender, então a venda registrada não mede a
              demanda real) usa o mínimo cadastrado como rede de segurança.
            </>
          )}
        </p>
        <a
          href={`/api/export/reposicao?${exportParams.toString()}`}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
        >
          Exportar CSV
        </a>
      </div>

      {rows.length > 0 && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Unidades faltando por loja</h2>
          <MetricBarChart
            data={Object.entries(
              rows.reduce<Record<string, number>>((acc, r) => {
                acc[r.storeName] = (acc[r.storeName] ?? 0) + r.falta;
                return acc;
              }, {})
            )
              .map(([key, value]) => ({ key, value }))
              .sort((a, b) => b.value - a.value)}
            color="var(--status-critical)"
          />
        </section>
      )}

      {modo === "minimo" ? (
        <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Loja</th>
                <th className="px-4 py-2 font-medium">Coleção</th>
                <th className="px-4 py-2 font-medium">Produto</th>
                <th className="px-4 py-2 font-medium">Tamanho</th>
                <th className="px-4 py-2 font-medium">Estoque</th>
                <th className="px-4 py-2 font-medium">Repor</th>
                <th className="px-4 py-2 font-medium">Mínimo</th>
                <th className="px-4 py-2 font-medium">Repor de</th>
                <th className="px-4 py-2 font-medium">Disponível na origem</th>
              </tr>
            </thead>
            <tbody>
              {rowsMinimo.map((r, i) => (
                <tr key={i} className="border-b border-[var(--gridline)] last:border-0">
                  <td className="px-4 py-2">{r.storeName}</td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{r.colecao ?? "—"}</td>
                  <td className="px-4 py-2 font-medium">{r.produto}</td>
                  <td className="px-4 py-2">{r.tamanho ?? "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{r.quantidadeDisponivel}</td>
                  <td className="px-4 py-2 tabular-nums font-medium" style={{ color: "var(--status-critical)" }}>
                    {r.falta}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{r.estoqueMinimo}</td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{r.origemSugerida}</td>
                  <td className="px-4 py-2 tabular-nums">{r.estoqueNaOrigem}</td>
                </tr>
              ))}
              {rowsMinimo.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Nada abaixo do estoque mínimo no filtro atual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <table className="w-full min-w-[950px] text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Loja</th>
                <th className="px-4 py-2 font-medium">Coleção</th>
                <th className="px-4 py-2 font-medium">Produto</th>
                <th className="px-4 py-2 font-medium">Tamanho</th>
                <th className="px-4 py-2 font-medium">Estoque</th>
                <th className="px-4 py-2 font-medium">Vendido na semana anterior</th>
                <th className="px-4 py-2 font-medium">Repor</th>
                <th className="px-4 py-2 font-medium">Repor de</th>
                <th className="px-4 py-2 font-medium">Disponível na origem</th>
              </tr>
            </thead>
            <tbody>
              {rowsVendas.map((r, i) => (
                <tr key={i} className="border-b border-[var(--gridline)] last:border-0">
                  <td className="px-4 py-2">{r.storeName}</td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{r.colecao ?? "—"}</td>
                  <td className="px-4 py-2 font-medium">{r.produto}</td>
                  <td className="px-4 py-2">{r.tamanho ?? "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{r.quantidadeDisponivel}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {r.zerouSemHistoricoDeVenda ? (
                      <span className="inline-flex items-center gap-1.5">
                        0
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                          style={{
                            backgroundColor: "color-mix(in srgb, var(--status-warning) 15%, transparent)",
                            color: "var(--status-warning)",
                          }}
                          title="Zerou e não teve venda registrada na semana — não dá pra medir demanda real sem estoque pra vender. Repor aqui usa o mínimo cadastrado."
                        >
                          zerado, sem venda pra medir
                        </span>
                      </span>
                    ) : (
                      r.vendasSemanaAnterior
                    )}
                  </td>
                  <td className="px-4 py-2 tabular-nums font-medium" style={{ color: "var(--status-critical)" }}>
                    {r.falta}
                  </td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{r.origemSugerida}</td>
                  <td className="px-4 py-2 tabular-nums">{r.estoqueNaOrigem}</td>
                </tr>
              ))}
              {rowsVendas.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Nada vendeu mais que o estoque disponível na semana anterior.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
