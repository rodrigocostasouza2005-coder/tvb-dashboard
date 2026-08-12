import { getSessionUser } from "@/lib/auth";
import { getEstoqueAtual, getEstoquePorArmazenador, getAllStores, getMarcas } from "@/lib/metrics";
import { getGrupoRestriction, canSeeFinancials, getStoreRestriction } from "@/lib/permissions";
import { parseFilters, parseDimension, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { DimensionToggle } from "../dimension-toggle";
import { PieChart } from "../pie-chart";
import { MetricBarChart } from "../metric-bar-chart";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function EstoqueAtualPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "estoque-atual");

  const rawParams = await searchParams;
  const dimension = parseDimension(rawParams);
  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const filters = { ...parseFilters(rawParams, { allowedStoreIds: allowedStores }), grupoIn };

  const [rows, porArmazenador, stores, marcas] = await Promise.all([
    getEstoqueAtual(filters, dimension),
    getEstoquePorArmazenador(filters),
    getAllStores(allowedStores),
    getMarcas(),
  ]);
  const showFinancials = canSeeFinancials(user.role);
  const totalQuantidade = rows.reduce((sum, r) => sum + r.quantidade, 0);
  const totalCusto = rows.reduce((sum, r) => sum + r.valorCusto, 0);

  return (
    <div>
      <FilterBar action="/dashboard/estoque-atual" stores={stores} marcas={marcas} filters={filters} showMarca={false} />
      <DimensionToggle basePath="/dashboard/estoque-atual" searchParams={rawParams} current={dimension} />

      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Estoque atual em tempo real, direto da API do DAPIC — escolha quais armazenadores ver no
        filtro de loja acima (inclui os que não são ponto de venda, tipo Defeito e Bonificação).
      </p>

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <div className="text-xs font-medium text-[var(--text-muted)]">Unidades em estoque</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{totalQuantidade.toLocaleString("pt-BR")}</div>
        </div>
        {showFinancials && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
            <div className="text-xs font-medium text-[var(--text-muted)]">Valor de custo total</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{formatBRL(totalCusto)}</div>
          </div>
        )}
      </section>

      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">% de estoque por armazenador</h2>
          <PieChart
            data={porArmazenador.map((p) => ({ label: p.storeName, value: p.quantidade, percentual: p.percentual }))}
          />
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            Top {dimension === "grupo" ? "grupo" : dimension === "produto" ? "produto" : "tamanho"} em estoque
          </h2>
          <MetricBarChart data={rows.slice(0, 10).map((r) => ({ key: r.key, value: r.quantidade }))} />
        </div>
      </section>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">
                {dimension === "grupo" ? "Grupo" : dimension === "produto" ? "Produto" : "Tamanho"}
              </th>
              <th className="px-4 py-2 font-medium">Quantidade</th>
              {showFinancials && <th className="px-4 py-2 font-medium">Valor de custo</th>}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((r) => (
              <tr key={r.key} className="border-b border-[var(--gridline)] last:border-0">
                <td className="px-4 py-2 font-medium">{r.key}</td>
                <td className="px-4 py-2 tabular-nums">{r.quantidade.toLocaleString("pt-BR")}</td>
                {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(r.valorCusto)}</td>}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={showFinancials ? 3 : 2} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Sem estoque pro filtro selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
