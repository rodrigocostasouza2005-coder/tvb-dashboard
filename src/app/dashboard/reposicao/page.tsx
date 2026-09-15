import { getSessionUser } from "@/lib/auth";
import {
  getReplenishment,
  getReplenishmentPorVendas,
  getStores,
  getMarcas,
  getDistinctColecoes,
  REPLENISHMENT_MOTIVO_LABEL,
  type ReplenishmentMotivo,
} from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { parseFilters, toDateInputValue, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { MetricBarChart } from "../metric-bar-chart";
import { ModoToggle, parseReplenishmentModo } from "./modo-toggle";

const MOTIVO_COLOR_VAR: Record<ReplenishmentMotivo, string> = {
  "alto-giro": "--status-critical",
  "baixo-giro": "--status-warning",
  "estoque-suficiente": "--status-good",
  "sem-necessidade": "--text-muted",
};

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
  // (getReplenishmentPorVendas) — ver lib/metrics.ts.
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

  const chartRows = modo === "minimo" ? rowsMinimo : rowsVendas.filter((r) => r.sugerirReposicao);

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
          showDate={modo === "vendas"}
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
              Calculado pelo giro real (vendas no período ÷ estoque disponível), não só pelo
              estoque mínimo cadastrado — evita sugerir reposição de item parado só porque o
              mínimo é baixo, e pega item de giro alto mesmo quando o mínimo não pegaria.
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

      {modo === "vendas" && (
        <div
          className="mb-3 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium"
          style={{
            borderColor: "var(--series-1)",
            backgroundColor: "color-mix(in srgb, var(--series-1) 10%, transparent)",
            color: "var(--series-1)",
          }}
        >
          Calculado pelo modo Vendas (giro) — período: {toDateInputValue(filters.from)} a {toDateInputValue(filters.to)}
        </div>
      )}

      {chartRows.length > 0 && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Unidades faltando por loja</h2>
          <MetricBarChart
            data={Object.entries(
              chartRows.reduce<Record<string, number>>((acc, r) => {
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
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Loja</th>
                <th className="px-4 py-2 font-medium">Coleção</th>
                <th className="px-4 py-2 font-medium">Produto</th>
                <th className="px-4 py-2 font-medium">Tamanho</th>
                <th className="px-4 py-2 font-medium">Estoque</th>
                <th className="px-4 py-2 font-medium">Vendido no período</th>
                <th className="px-4 py-2 font-medium">Dias de cobertura</th>
                <th className="px-4 py-2 font-medium">Repor</th>
                <th className="px-4 py-2 font-medium">Mínimo</th>
                <th className="px-4 py-2 font-medium">Motivo</th>
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
                  <td className="px-4 py-2 tabular-nums">{r.vendasNoPeriodo}</td>
                  <td className="px-4 py-2 tabular-nums">{r.diasCobertura ?? "—"}</td>
                  <td
                    className="px-4 py-2 tabular-nums font-medium"
                    style={{ color: r.sugerirReposicao ? "var(--status-critical)" : "var(--text-muted)" }}
                  >
                    {r.sugerirReposicao ? r.falta : "—"}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{r.estoqueMinimo}</td>
                  <td className="px-4 py-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: `color-mix(in srgb, var(${MOTIVO_COLOR_VAR[r.motivo]}) 15%, transparent)`,
                        color: `var(${MOTIVO_COLOR_VAR[r.motivo]})`,
                      }}
                    >
                      {REPLENISHMENT_MOTIVO_LABEL[r.motivo]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{r.origemSugerida}</td>
                  <td className="px-4 py-2 tabular-nums">{r.estoqueNaOrigem}</td>
                </tr>
              ))}
              {rowsVendas.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Nada com risco de ruptura pelo giro real no filtro atual.
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
