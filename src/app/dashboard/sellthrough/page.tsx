import { getSessionUser } from "@/lib/auth";
import {
  getSellthroughByColecao,
  getSellthroughColecaoDetalhe,
  getColecaoCurvaVida,
  getColecoes,
  getStores,
  getMarcas,
  getTabelasPreco,
} from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { ColecaoSellthroughTable } from "./colecao-sellthrough-table";
import { ColecaoDetalheChart } from "./colecao-detalhe-chart";
import { ColecaoDetalheTable } from "./colecao-detalhe-table";
import { IndicatorChart } from "../indicadores/indicator-chart";

const CORES_CURVA = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)", "var(--cat-7)", "var(--cat-8)"];
const JANELA_CURVA_DIAS = 90;

export default async function SellthroughPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "sellthrough");

  const rawParams = await searchParams;
  const filtrosOpen = rawParams.filtros === "1";
  // Nome de parâmetro próprio (não "colecao") pra não colidir com o filtro básico de Coleção
  // (multi-seleção, no topo) — esse aqui é um drilldown de 1 coleção só, pro detalhe por produto.
  const colecaoParam = typeof rawParams.colecaoDetalhe === "string" && rawParams.colecaoDetalhe ? rawParams.colecaoDetalhe : undefined;

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

  // Curva de vida: quais coleções comparar (checkbox própria, independente dos filtros de cima —
  // mesmo padrão já usado no seletor de "Detalhe por produto" logo abaixo). Sem seleção explícita,
  // mostra as 5 coleções com mais unidades vendidas por padrão.
  const curvaParam = rawParams.curva;
  const curvaSelecionadasParam = Array.isArray(curvaParam) ? curvaParam : typeof curvaParam === "string" ? [curvaParam] : undefined;
  const top5PorVendido = [...colecaoRows].sort((a, b) => b.vendido - a.vendido).slice(0, 5).map((r) => r.key);
  const curvaSelecionadas = curvaSelecionadasParam ?? top5PorVendido;
  const curvaAlvo = colecaoRows
    .filter((r) => curvaSelecionadas.includes(r.key))
    .map((r) => ({ colecao: r.key, produzido: r.produzido }));
  const curvaVida = await getColecaoCurvaVida(filters, curvaAlvo, JANELA_CURVA_DIAS);
  const curvaSeries = curvaVida.map((c, i) => ({ key: c.colecao, name: c.colecao, color: CORES_CURVA[i % CORES_CURVA.length] }));
  const curvaData = Array.from({ length: JANELA_CURVA_DIAS + 1 }, (_, dias) => {
    const row: Record<string, string | number | null> = { dias };
    for (const c of curvaVida) row[c.colecao] = dias < c.pontos.length ? Number(c.pontos[dias].percCumulativo.toFixed(1)) : null;
    return row;
  });

  const totalProduzido = detalheRows.reduce((s, r) => s + r.produzido, 0);
  const totalSaida = detalheRows.reduce((s, r) => s + r.saida, 0);
  const totalVendido = detalheRows.reduce((s, r) => s + r.vendido, 0);
  const totalBrinde = detalheRows.reduce((s, r) => s + r.brinde, 0);
  const stGeral = totalProduzido > 0 ? (totalSaida / totalProduzido) * 100 : null;

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/sellthrough"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          colecoes={colecoes}
          showTabelaPreco
          showDate={false}
          filters={filters}
        />
      </CollapsibleFilters>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <p className="text-xs text-[var(--text-muted)]">Sell-through geral</p>
          <p className="mt-1 text-2xl font-bold">{stGeral != null ? `${stGeral.toFixed(1)}%` : "—"}</p>
          <p className="text-xs text-[var(--text-muted)]">saída / (estoque atual + saída)</p>
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
        Sell-through = saída / (estoque atual + saída), onde saída = vendas − devoluções + brindes. Cobre toda a vida de cada coleção.
      </p>
      <ColecaoSellthroughTable rows={colecaoRows} />

      {/* Curva de vida: sell-through acumulado por dias desde a 1ª venda, pra comparar coleções
          na mesma régua de tempo em vez de calendário fixo. */}
      <div className="mt-8 mb-3">
        <h2 className="text-base font-semibold">Curva de vida da coleção</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Sell-through acumulado a partir do dia da 1ª venda de cada coleção (primeiros {JANELA_CURVA_DIAS} dias) — responde
          &quot;com quantos dias de vida essa coleção bateu 50%/80%?&quot;. Aproximado: soma o vendido dia a dia contra o mesmo
          estoque+saída da tabela acima, sem descontar devolução/brinde dia a dia.
        </p>
      </div>

      <form method="GET" action="/dashboard/sellthrough" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 text-sm">
        {colecoes.map((c) => (
          <label key={c} className="flex items-center gap-1.5 text-[var(--text-secondary)]">
            <input type="checkbox" name="curva" value={c} defaultChecked={curvaSelecionadas.includes(c)} className="rounded border-[var(--border)]" />
            {c}
          </label>
        ))}
        <button type="submit" className="rounded-md bg-[var(--series-1)] px-3 py-1.5 text-xs font-medium text-white">
          Comparar
        </button>
      </form>

      {curvaVida.length > 0 ? (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <IndicatorChart data={curvaData} series={curvaSeries} format="percent" granularity="dias" />
        </section>
      ) : (
        <p className="mb-6 text-sm text-[var(--text-muted)]">Nenhuma coleção selecionada tem dados suficientes pra essa curva.</p>
      )}

      {/* Filtro de coleção + detalhe grupo→produto */}
      <div className="mt-8 mb-3 flex items-center gap-3">
        <h2 className="text-base font-semibold">Detalhe por produto</h2>
        <form method="GET" action="/dashboard/sellthrough" className="flex items-center gap-2">
          <select
            name="colecaoDetalhe"
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
          <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Sell-through por produto</h3>
          <ColecaoDetalheChart rows={detalheRows} />
        </section>
      )}

      <ColecaoDetalheTable rows={detalheRows} />
    </div>
  );
}
