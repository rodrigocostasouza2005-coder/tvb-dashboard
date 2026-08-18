import { getSessionUser } from "@/lib/auth";
import {
  getSellthroughByColecao,
  getSellthroughColecaoDetalhe,
  getColecoes,
  getStores,
  getMarcas,
  getTabelasPreco,
} from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { ColecaoSellthroughTable } from "./colecao-sellthrough-table";
import { ColecaoDetalheChart } from "./colecao-detalhe-chart";
import { ColecaoDetalheTable } from "./colecao-detalhe-table";

export default async function SellthroughPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "sellthrough");

  const rawParams = await searchParams;
  const colecaoParam = typeof rawParams.colecao === "string" && rawParams.colecao ? rawParams.colecao : undefined;

  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  const [colecaoRows, detalheRows, colecoes, stores, marcas, tabelasPreco] = await Promise.all([
    getSellthroughByColecao(filters),
    getSellthroughColecaoDetalhe(filters, colecaoParam),
    getColecoes(filters),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
  ]);

  const totalProduzido = detalheRows.reduce((s, r) => s + r.produzido, 0);
  const totalSaida = detalheRows.reduce((s, r) => s + r.saida, 0);
  const totalVendido = detalheRows.reduce((s, r) => s + r.vendido, 0);
  const totalBrinde = detalheRows.reduce((s, r) => s + r.brinde, 0);
  const stGeral = totalProduzido > 0 ? (totalSaida / totalProduzido) * 100 : null;

  return (
    <div>
      <FilterBar
        action="/dashboard/sellthrough"
        stores={stores}
        marcas={marcas}
        tabelasPreco={tabelasPreco}
        showTabelaPreco
        showDate={false}
        filters={filters}
      />

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <p className="text-xs text-[var(--text-muted)]">Sell-through geral</p>
          <p className="mt-1 text-2xl font-bold">{stGeral != null ? `${stGeral.toFixed(1)}%` : "—"}</p>
          <p className="text-xs text-[var(--text-muted)]">(vendas + brindes) / produzido</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <p className="text-xs text-[var(--text-muted)]">Produzido</p>
          <p className="mt-1 text-2xl font-bold">{totalProduzido.toLocaleString("pt-BR")}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <p className="text-xs text-[var(--text-muted)]">Vendas</p>
          <p className="mt-1 text-2xl font-bold">{totalVendido.toLocaleString("pt-BR")}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <p className="text-xs text-[var(--text-muted)]">Brindes</p>
          <p className="mt-1 text-2xl font-bold">{totalBrinde.toLocaleString("pt-BR")}</p>
        </div>
      </div>

      {/* Tabela de coleções — ordenada por sell-through */}
      <h2 className="mb-3 text-base font-semibold">Sell-through por coleção</h2>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Sell-through = (vendido + brinde) / produzido. Sem filtro de data — cobre toda a vida de cada coleção.
      </p>
      <ColecaoSellthroughTable rows={colecaoRows} />

      {/* Filtro de coleção + detalhe grupo→produto */}
      <div className="mt-8 mb-3 flex items-center gap-3">
        <h2 className="text-base font-semibold">Detalhe por produto</h2>
        <form method="GET" action="/dashboard/sellthrough" className="flex items-center gap-2">
          <select
            name="colecao"
            defaultValue={colecaoParam ?? ""}
            className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]"
          >
            <option value="">Todas as coleções</option>
            {colecoes.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-[var(--series-1)] px-3 py-1.5 text-xs font-medium text-white">
            Filtrar
          </button>
        </form>
      </div>

      {detalheRows.length > 0 && (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Sell-through por produto (top 20)</h3>
          <ColecaoDetalheChart rows={detalheRows} />
        </section>
      )}

      <ColecaoDetalheTable rows={detalheRows} />
    </div>
  );
}
