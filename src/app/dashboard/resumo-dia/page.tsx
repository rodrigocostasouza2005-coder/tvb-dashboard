import { getSessionUser } from "@/lib/auth";
import { getVendasHojeComComparacao, getMaisVendidosSemana, getTopParaIncentivar } from "@/lib/metrics";
import { canSeeFinancials, getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { requireTabAccess } from "@/lib/tabs";
import { StatTile } from "../stat-tile";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatVariacao(pct: number | null) {
  if (pct === null) return "sem histórico de comparação";
  const sinal = pct >= 0 ? "+" : "";
  return `${sinal}${pct.toFixed(0)}% vs. média dos últimos dias`;
}

export default async function ResumoDiaPage() {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "resumo-dia");

  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = { storeIds: allowedStores, marcas: allowedMarcas, tabelasPreco: allowedTabelasPreco, grupoIn };
  const showFinancials = canSeeFinancials(user);

  const [resumo, maisVendidos, produtosParados] = await Promise.all([
    getVendasHojeComComparacao(filters),
    getMaisVendidosSemana(filters),
    getTopParaIncentivar(30, 10, allowedStores),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">Resumo do Dia</h1>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatTile
          label="Unidades vendidas hoje"
          value={resumo.hojeUnidades.toLocaleString("pt-BR")}
          subValue={formatVariacao(resumo.variacaoUnidadesPct)}
          trend={resumo.variacaoUnidadesPct === null ? undefined : resumo.variacaoUnidadesPct >= 0 ? "up" : "down"}
        />
        {showFinancials && (
          <StatTile
            label="Receita hoje"
            value={formatBRL(resumo.hojeReceita)}
            subValue={formatVariacao(resumo.variacaoReceitaPct)}
            trend={resumo.variacaoReceitaPct === null ? undefined : resumo.variacaoReceitaPct >= 0 ? "up" : "down"}
          />
        )}
      </div>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Mais vendidos na semana</h2>
        {maisVendidos.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Sem vendas nos últimos 7 dias.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Produto</th>
                <th className="px-4 py-2 font-medium">Unidades</th>
                {showFinancials && <th className="px-4 py-2 font-medium">Receita</th>}
              </tr>
            </thead>
            <tbody>
              {maisVendidos.map((r, i) => (
                <tr key={r.produto} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 text-[var(--text-muted)]">{i + 1}</td>
                  <td className="px-4 py-2 font-medium">{r.produto}</td>
                  <td className="px-4 py-2 tabular-nums">{r.unidades.toLocaleString("pt-BR")}</td>
                  {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(r.receita)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
        <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Produtos parados</h2>
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          Bastante estoque e pouca venda nos últimos 30 dias — bons candidatos pra oferecer ao cliente.
        </p>
        {produtosParados.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Nenhum produto parado identificado.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Produto</th>
                <th className="px-4 py-2 font-medium">Estoque atual</th>
                <th className="px-4 py-2 font-medium">Vendido (30d)</th>
              </tr>
            </thead>
            <tbody>
              {produtosParados.map((r, i) => (
                <tr key={r.produto} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 text-[var(--text-muted)]">{i + 1}</td>
                  <td className="px-4 py-2 font-medium">{r.produto}</td>
                  <td className="px-4 py-2 tabular-nums">{r.estoque.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 tabular-nums">{r.vendido.toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
