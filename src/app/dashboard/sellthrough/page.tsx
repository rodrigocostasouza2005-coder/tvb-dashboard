import { getSessionUser } from "@/lib/auth";
import {
  getStockVsSales,
  getSellthroughByColecao,
  getSellthroughColecaoDetalhe,
  getColecoes,
  getStores,
  getMarcas,
  getTabelasPreco,
} from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, parseDimension, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { DimensionToggle } from "../dimension-toggle";
import { statusFor } from "../status-filter";
import { SellthroughTable } from "./sellthrough-table";
import { SellthroughBarChart } from "./sellthrough-bar-chart";
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
  const dimension = parseDimension(rawParams);
  const isColecao = dimension === "colecao";

  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  // Coleção selecionada via ?colecao=
  const colecaoParam = typeof rawParams.colecao === "string" ? rawParams.colecao : undefined;

  const [colecaoRows, detalheRows, colecoes, stockVsSalesRows, stores, marcas, tabelasPreco] = await Promise.all([
    isColecao ? getSellthroughByColecao(filters) : Promise.resolve([]),
    isColecao ? getSellthroughColecaoDetalhe(filters, colecaoParam) : Promise.resolve([]),
    isColecao ? getColecoes(filters) : Promise.resolve([]),
    isColecao ? Promise.resolve([]) : getStockVsSales(filters, dimension),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
  ]);

  const withStatus = stockVsSalesRows.map((r) => ({ ...r, status: statusFor(r.sellThroughRate) }));

  // Stat geral da coleção selecionada (ou de todas)
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
        showDate={!isColecao}
        filters={filters}
      />
      <div className="mb-1 flex flex-wrap items-center gap-4">
        <DimensionToggle basePath="/dashboard/sellthrough" searchParams={rawParams} current={dimension} showColecao />
      </div>

      {isColecao ? (
        <>
          {/* Seletor de coleção */}
          <form method="GET" action="/dashboard/sellthrough" className="mb-4 flex items-center gap-3">
            <input type="hidden" name="dim" value="colecao" />
            <label className="text-xs font-medium text-[var(--text-muted)]">Coleção</label>
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
              Aplicar
            </button>
          </form>

          {/* Stat card geral */}
          {totalProduzido > 0 && (
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
          )}

          {/* Gráfico por produto */}
          {detalheRows.length > 0 && (
            <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
              <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Sell-through por produto (top 20)</h2>
              <ColecaoDetalheChart rows={detalheRows} />
            </section>
          )}

          {/* Tabela grupo → produto */}
          <ColecaoDetalheTable rows={detalheRows} />

          {/* Tabela resumo por coleção */}
          <h2 className="mb-3 mt-8 text-base font-semibold">Resumo por coleção</h2>
          <ColecaoSellthroughTable rows={colecaoRows} />
        </>
      ) : (
        <>
          <p className="mb-3 text-xs text-[var(--text-muted)]">
            Sell-through = vendido / (vendido + estoque atual). Giro = vendido / estoque atual (aproximação
            até termos série histórica de estoque via sync automático).
          </p>
          <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
            <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
              Sell-through por {dimension === "grupo" ? "grupo" : dimension === "produto" ? "produto" : "tamanho"}
            </h2>
            <SellthroughBarChart data={withStatus} />
          </section>
          <SellthroughTable
            rows={withStatus}
            dimensionLabel={dimension === "grupo" ? "Grupo" : dimension === "produto" ? "Produto" : "Tamanho"}
          />
        </>
      )}
    </div>
  );
}
