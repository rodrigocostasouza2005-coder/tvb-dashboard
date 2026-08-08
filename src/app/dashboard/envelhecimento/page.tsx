import { getSessionUser } from "@/lib/auth";
import { getStockAging, getAllStores, getMarcas } from "@/lib/metrics";
import { getGrupoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { StatTile } from "../stat-tile";

function ageStatus(dias: number): { label: string; color: string } {
  if (dias <= 30) return { label: "Novo", color: "var(--status-good)" };
  if (dias <= 60) return { label: "Atenção", color: "var(--status-warning)" };
  if (dias <= 90) return { label: "Velho", color: "var(--status-serious)" };
  return { label: "Muito velho", color: "var(--status-critical)" };
}

function formatDate(d: Date | null) {
  return d ? new Date(d).toLocaleDateString("pt-BR") : "—";
}

export default async function EnvelhecimentoPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "envelhecimento");

  const grupoIn = await getGrupoRestriction(user.role);
  const filters = { ...parseFilters(await searchParams), grupoIn };

  const [allRows, stores, marcas] = await Promise.all([
    getStockAging(filters),
    getAllStores(),
    getMarcas(),
  ]);

  // Itens que nunca venderam ficam de fora da tabela de envelhecimento: com só ~dias de
  // histórico real de vendas (sync via API começou em 2026-08-07), a maior parte do estoque
  // ainda não teve chance de vender nesse período — misturar os dois faz "nunca vendeu" (tratado
  // como "infinitamente velho") dominar a lista inteira e esconder os itens que realmente
  // envelheceram vendendo pouco, que é o dado que interessa aqui.
  const rows = allRows.filter(
    (r): r is typeof r & { diasDesdePrimeiraVenda: number } => r.diasDesdePrimeiraVenda !== null
  );
  const neverSoldCount = allRows.length - rows.length;

  return (
    <div>
      <FilterBar action="/dashboard/envelhecimento" stores={stores} marcas={marcas} filters={filters} showMarca={false} />
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Idade contada a partir da <strong>primeira venda</strong> daquele produto naquela loja (não
        da última) — pra saber desde quando ele realmente começou a vender. Só mostra itens com
        estoque disponível agora e que já venderam pelo menos uma vez.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Itens com histórico de venda" value={String(rows.length)} />
        <StatTile
          label="Em estoque, nunca vendido"
          value={String(neverSoldCount)}
          status={neverSoldCount > 0 ? "warning" : "good"}
        />
      </div>
      {neverSoldCount > 0 && (
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          {neverSoldCount} itens em estoque ainda não têm nenhuma venda registrada no período
          coberto pela sync — pode ser estoque parado ou só falta de histórico (a sync via API
          começou recentemente). Acompanhe esse número ao longo do tempo.
        </p>
      )}

      <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Loja</th>
              <th className="px-4 py-2 font-medium">Produto</th>
              <th className="px-4 py-2 font-medium">Tamanho</th>
              <th className="px-4 py-2 font-medium">Estoque</th>
              <th className="px-4 py-2 font-medium">1ª venda</th>
              <th className="px-4 py-2 font-medium">Dias desde 1ª venda</th>
              <th className="px-4 py-2 font-medium">Última venda</th>
              <th className="px-4 py-2 font-medium">Sell-through</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 150).map((r, i) => {
              const status = ageStatus(r.diasDesdePrimeiraVenda);
              return (
                <tr key={i} className="border-b border-[var(--gridline)] last:border-0">
                  <td className="px-4 py-2">{r.storeName}</td>
                  <td className="px-4 py-2 font-medium">{r.produto}</td>
                  <td className="px-4 py-2">{r.tamanho ?? "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{r.quantidadeDisponivel}</td>
                  <td className="px-4 py-2">{formatDate(r.primeiraVenda)}</td>
                  <td className="px-4 py-2 tabular-nums">{r.diasDesdePrimeiraVenda ?? "—"}</td>
                  <td className="px-4 py-2">{formatDate(r.ultimaVenda)}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {r.sellThroughRate !== null ? `${r.sellThroughRate.toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: status.color }} />
                      {status.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Nenhum item com estoque e histórico de venda pro filtro selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
