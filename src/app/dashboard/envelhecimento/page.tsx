import { getSessionUser } from "@/lib/auth";
import { getStockAging, getAllStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { StatTile } from "../stat-tile";
import { EnvelhecimentoTable } from "./envelhecimento-table";

function ageStatus(dias: number): { label: string; color: string } {
  if (dias <= 30) return { label: "Novo", color: "var(--status-good)" };
  if (dias <= 60) return { label: "Atenção", color: "var(--status-warning)" };
  if (dias <= 90) return { label: "Velho", color: "var(--status-serious)" };
  return { label: "Muito velho", color: "var(--status-critical)" };
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
  const allowedStores = getStoreRestriction(user);
  const filters = { ...parseFilters(await searchParams, allowedStores), grupoIn };

  const [allRows, stores, marcas, tabelasPreco] = await Promise.all([
    getStockAging(filters),
    getAllStores(allowedStores),
    getMarcas(),
    getTabelasPreco(),
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
      <FilterBar
        action="/dashboard/envelhecimento"
        stores={stores}
        marcas={marcas}
        tabelasPreco={tabelasPreco}
        showTabelaPreco
        filters={filters}
        showMarca={false}
      />
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

      <EnvelhecimentoTable rows={rows.map((r) => ({ ...r, status: ageStatus(r.diasDesdePrimeiraVenda) }))} />
    </div>
  );
}
