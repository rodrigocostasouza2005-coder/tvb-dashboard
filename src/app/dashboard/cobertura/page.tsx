import { getSessionUser } from "@/lib/auth";
import { getStockCoverage, getAllStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { StatTile } from "../stat-tile";
import { CoberturaTable } from "./cobertura-table";

export default async function CoberturaPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "cobertura");

  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(await searchParams, { allowedStoreIds: allowedStores, allowedTabelasPreco }),
    grupoIn,
  };

  const [rows, stores, marcas, tabelasPreco] = await Promise.all([
    getStockCoverage(filters),
    getAllStores(allowedStores),
    getMarcas(),
    getTabelasPreco(allowedTabelasPreco),
  ]);

  const critico = rows.filter((r) => r.status === "critico").length;
  const atencao = rows.filter((r) => r.status === "atencao").length;
  const ok = rows.filter((r) => r.status === "ok").length;
  const semVenda = rows.filter((r) => r.status === "sem-venda").length;

  return (
    <div>
      <FilterBar
        action="/dashboard/cobertura"
        stores={stores}
        marcas={marcas}
        tabelasPreco={tabelasPreco}
        showTabelaPreco
        showDate={false}
        showMarca={false}
        filters={filters}
      />
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Mostra quantos <strong>dias de venda restam</strong> em cada SKU, com base na média de
        vendas dos últimos 30 dias. Crítico = menos de 7 dias. Atenção = menos de 30 dias.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Crítico (< 7 dias)"
          value={String(critico)}
          status={critico > 0 ? "critical" : "good"}
        />
        <StatTile
          label="Atenção (< 30 dias)"
          value={String(atencao)}
          status={atencao > 0 ? "warning" : "good"}
        />
        <StatTile
          label="OK (≥ 30 dias)"
          value={String(ok)}
          status="good"
        />
        <StatTile
          label="Sem venda recente"
          value={String(semVenda)}
        />
      </div>

      <CoberturaTable rows={rows} />
    </div>
  );
}
