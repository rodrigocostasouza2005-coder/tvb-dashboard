import { getSessionUser } from "@/lib/auth";
import { getSalesByGrupoProduto, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { canSeeFinancials, getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { ParetoChart } from "./pareto-chart";

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatPct(v: number) {
  return v.toLocaleString("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

type AbcClass = "A" | "B" | "C";

function classifyAbc(rows: { revenue: number }[]): AbcClass[] {
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  if (total === 0) return rows.map(() => "C");
  let cumulative = 0;
  return rows.map((r) => {
    cumulative += r.revenue;
    const pct = cumulative / total;
    return pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C";
  });
}

const BADGE: Record<AbcClass, string> = {
  A: "bg-[var(--status-good)]/15 text-[var(--status-good)] border border-[var(--status-good)]/30",
  B: "bg-[var(--status-warning)]/15 text-[var(--status-warning)] border border-[var(--status-warning)]/30",
  C: "bg-[var(--status-critical)]/15 text-[var(--status-critical)] border border-[var(--status-critical)]/30",
};

function AbcTable({
  title,
  rows,
  showFinancials,
  nameLabel,
  extraCol,
}: {
  title: string;
  rows: { name: string; extra?: string; unitsSold: number; revenue: number }[];
  showFinancials: boolean;
  nameLabel: string;
  extraCol?: string;
}) {
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  const classes = classifyAbc(rows);
  let cumRevenue = 0;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">{title}</h2>
      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Classe</th>
              <th className="px-4 py-2 font-medium">#</th>
              {extraCol && <th className="px-4 py-2 font-medium">{extraCol}</th>}
              <th className="px-4 py-2 font-medium">{nameLabel}</th>
              <th className="px-4 py-2 font-medium text-right">Unidades</th>
              {showFinancials && (
                <>
                  <th className="px-4 py-2 font-medium text-right">Receita</th>
                  <th className="px-4 py-2 font-medium text-right">% individual</th>
                  <th className="px-4 py-2 font-medium text-right">% acumulado</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const cls = classes[i];
              cumRevenue += r.revenue;
              const pctInd = total > 0 ? r.revenue / total : 0;
              const pctCum = total > 0 ? cumRevenue / total : 0;
              return (
                <tr key={i} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold ${BADGE[cls]}`}>
                      {cls}
                    </span>
                  </td>
                  <td className="px-4 py-2 tabular-nums text-[var(--text-muted)]">{i + 1}</td>
                  {extraCol && <td className="px-4 py-2 text-[var(--text-secondary)]">{r.extra ?? "—"}</td>}
                  <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{r.name}</td>
                  <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                    {r.unitsSold.toLocaleString("pt-BR")}
                  </td>
                  {showFinancials && (
                    <>
                      <td className="px-4 py-2 tabular-nums text-right text-[var(--text-primary)]">
                        {formatBRL(r.revenue)}
                      </td>
                      <td className="px-4 py-2 tabular-nums text-right text-[var(--text-muted)]">
                        {formatPct(pctInd)}
                      </td>
                      <td className="px-4 py-2 tabular-nums text-right text-[var(--text-muted)]">
                        {formatPct(pctCum)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={showFinancials ? (extraCol ? 8 : 7) : (extraCol ? 5 : 4)} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Sem vendas no período selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function CurvaAbcPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "curva-abc");

  const rawParams = await searchParams;
  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  const [allRows, stores, marcas, tabelasPreco] = await Promise.all([
    getSalesByGrupoProduto(filters),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
  ]);

  const showFinancials = canSeeFinancials(user);

  // Por produto — já vem ordenado por receita desc
  const porProduto = allRows
    .filter((r) => r.revenue > 0)
    .map((r) => ({ name: r.key, extra: r.grupo, unitsSold: r.unitsSold, revenue: r.revenue }));

  // Por grupo — agrega produto rows por grupo
  const grupoMap = new Map<string, { unitsSold: number; revenue: number }>();
  for (const r of allRows) {
    const prev = grupoMap.get(r.grupo) ?? { unitsSold: 0, revenue: 0 };
    grupoMap.set(r.grupo, { unitsSold: prev.unitsSold + r.unitsSold, revenue: prev.revenue + r.revenue });
  }
  const porGrupo = [...grupoMap.entries()]
    .filter(([, v]) => v.revenue > 0)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([grupo, v]) => ({ name: grupo, unitsSold: v.unitsSold, revenue: v.revenue }));

  // Contagem por classe para o resumo
  const grupoClasses = classifyAbc(porGrupo);
  const produtoClasses = classifyAbc(porProduto);
  const countBy = (cls: AbcClass[], c: AbcClass) => cls.filter((x) => x === c).length;

  return (
    <div>
      <FilterBar
        action="/dashboard/curva-abc"
        stores={stores}
        marcas={marcas}
        tabelasPreco={tabelasPreco}
        showTabelaPreco
        filters={filters}
      />

      {/* Resumo de contagem */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-6">
        {(["A", "B", "C"] as AbcClass[]).map((cls) => (
          <div key={`g-${cls}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
            <p className="text-xs text-[var(--text-muted)]">Grupos {cls}</p>
            <p className="mt-1 text-2xl font-bold text-[var(--text-primary)]">{countBy(grupoClasses, cls)}</p>
          </div>
        ))}
        {(["A", "B", "C"] as AbcClass[]).map((cls) => (
          <div key={`p-${cls}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
            <p className="text-xs text-[var(--text-muted)]">Produtos {cls}</p>
            <p className="mt-1 text-2xl font-bold text-[var(--text-primary)]">{countBy(produtoClasses, cls)}</p>
          </div>
        ))}
      </div>

      {showFinancials && <ParetoChart rows={porGrupo} />}
      <AbcTable
        title="Curva ABC por Grupo"
        rows={porGrupo}
        showFinancials={showFinancials}
        nameLabel="Grupo"
      />

      {showFinancials && <ParetoChart rows={porProduto} />}
      <AbcTable
        title="Curva ABC por Produto"
        rows={porProduto}
        showFinancials={showFinancials}
        nameLabel="Produto"
        extraCol="Grupo"
      />
    </div>
  );
}
