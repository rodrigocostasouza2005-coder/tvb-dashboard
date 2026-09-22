import { getSessionUser } from "@/lib/auth";
import { getSellthroughByColecao, getColecaoCurvaVida, getColecoes, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { IndicatorChart } from "../indicadores/indicator-chart";

const CORES_CURVA = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)", "var(--cat-7)", "var(--cat-8)"];
const JANELA_DIA = 90;
const JANELA_MES = 360; // 12 meses de 30 dias

function formatDataBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default async function CurvaVidaColecaoPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "curva-vida-colecao");

  const rawParams = await searchParams;
  const filtrosOpen = rawParams.filtros === "1";
  const visao = rawParams.visao === "mes" ? "mes" : "dia";

  const grupoIn = await getGrupoRestriction(user.role);
  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores, allowedMarcas, allowedTabelasPreco }),
    grupoIn,
  };

  const [colecaoRows, colecoes, stores, marcas, tabelasPreco] = await Promise.all([
    getSellthroughByColecao(filters),
    getColecoes(filters),
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
  ]);

  // Quais coleções comparar — sem seleção explícita, as 5 com mais unidades vendidas.
  const curvaParam = rawParams.curva;
  const curvaSelecionadasParam = Array.isArray(curvaParam) ? curvaParam : typeof curvaParam === "string" ? [curvaParam] : undefined;
  const top5PorVendido = [...colecaoRows].sort((a, b) => b.vendido - a.vendido).slice(0, 5).map((r) => r.key);
  const curvaSelecionadas = curvaSelecionadasParam ?? top5PorVendido;
  const curvaAlvo = colecaoRows
    .filter((r) => curvaSelecionadas.includes(r.key))
    .map((r) => ({ colecao: r.key, produzido: r.produzido }));

  function visaoHref(v: "dia" | "mes") {
    const p = new URLSearchParams();
    for (const id of filters.storeIds ?? []) p.append("store", id);
    for (const m of filters.marcas ?? []) p.append("marca", m);
    for (const t of filters.tabelasPreco ?? []) p.append("tabelaPreco", t);
    for (const c of curvaSelecionadas) p.append("curva", c);
    p.set("visao", v);
    return `/dashboard/curva-vida-colecao?${p.toString()}`;
  }

  const janela = visao === "mes" ? JANELA_MES : JANELA_DIA;
  const curvaVida = await getColecaoCurvaVida(filters, curvaAlvo, janela);
  const curvaSeries = curvaVida.map((c, i) => ({ key: c.colecao, name: c.colecao, color: CORES_CURVA[i % CORES_CURVA.length] }));

  // Estoque restante (%) = 100 − sell-through acumulado — a coleção começa perto de 100% (recém
  // chegada) e cai até esgotar. Pedido do Rodrigo em 2026-09-22: "não deveria ser o estoque
  // caindo, e não ela subindo?" — a curva anterior mostrava o vendido acumulado (subindo), essa
  // mostra o que falta vender (caindo), mais intuitivo pra pensar em "quando isso esgota".
  const estoqueRestante = (percCumulativo: number) => Math.max(0, 100 - percCumulativo);

  const curvaData =
    visao === "dia"
      ? Array.from({ length: JANELA_DIA + 1 }, (_, dias) => {
          const row: Record<string, string | number | null> = { dias };
          for (const c of curvaVida) row[c.colecao] = dias < c.pontos.length ? Number(estoqueRestante(c.pontos[dias].percCumulativo).toFixed(1)) : null;
          return row;
        })
      : Array.from({ length: JANELA_MES / 30 }, (_, i) => {
          const mes = i + 1;
          const diaInicio = (mes - 1) * 30;
          const diaFim = mes * 30 - 1;
          const row: Record<string, string | number | null> = { mesesVida: mes };
          for (const c of curvaVida) {
            if (diaInicio > c.pontos.length - 1) {
              row[c.colecao] = null;
            } else {
              const ponto = c.pontos[Math.min(diaFim, c.pontos.length - 1)];
              row[c.colecao] = Number(estoqueRestante(ponto.percCumulativo).toFixed(1));
            }
          }
          return row;
        });

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/curva-vida-colecao"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          colecoes={colecoes}
          showTabelaPreco
          showColecao={false}
          showDate={false}
          filters={filters}
        />
      </CollapsibleFilters>

      <p className="mb-4 text-sm text-[var(--text-secondary)]">
        Estoque restante (%) a partir do dia da 1ª venda de cada coleção — começa perto de 100% e cai até esgotar. Responde
        &quot;com quantos {visao === "mes" ? "meses" : "dias"} de vida essa coleção deve esgotar?&quot;. &quot;{visao === "mes" ? "Mês 1" : "Dia 0"}&quot; = data
        da 1ª venda registrada (proxy de lançamento — o DAPIC não expõe uma data de lançamento formal). Aproximado: soma o
        vendido dia a dia contra o mesmo estoque+saída da tabela de Sell-through, sem descontar devolução/brinde dia a dia.
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
        <form method="GET" action="/dashboard/curva-vida-colecao" className="flex flex-wrap items-center gap-2">
          {(filters.storeIds ?? []).map((id) => <input key={id} type="hidden" name="store" value={id} />)}
          {(filters.marcas ?? []).map((m) => <input key={m} type="hidden" name="marca" value={m} />)}
          {(filters.tabelasPreco ?? []).map((t) => <input key={t} type="hidden" name="tabelaPreco" value={t} />)}
          <input type="hidden" name="visao" value={visao} />
          {colecoes.map((c) => (
            <label key={c} className="cursor-pointer">
              <input type="checkbox" name="curva" value={c} defaultChecked={curvaSelecionadas.includes(c)} className="peer sr-only" />
              <span className="inline-block rounded-full border border-[var(--border)] bg-[var(--page-plane)] px-3 py-1 text-xs text-[var(--text-secondary)] transition-colors peer-checked:border-[var(--series-1)] peer-checked:bg-[var(--series-1)] peer-checked:text-white">
                {c}
              </span>
            </label>
          ))}
          <button type="submit" className="rounded-md bg-[var(--series-1)] px-3 py-1.5 text-xs font-medium text-white">
            Comparar
          </button>
        </form>

        <div className="flex overflow-hidden rounded-md border border-[var(--border)] text-xs">
          <a
            href={visaoHref("dia")}
            className={`px-3 py-1.5 ${visao === "dia" ? "bg-[var(--series-1)] text-white" : "text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"}`}
          >
            Dia a dia
          </a>
          <a
            href={visaoHref("mes")}
            className={`px-3 py-1.5 ${visao === "mes" ? "bg-[var(--series-1)] text-white" : "text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"}`}
          >
            Mês a mês
          </a>
        </div>
      </div>

      {curvaVida.length > 0 ? (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <IndicatorChart data={curvaData} series={curvaSeries} format="percent" granularity={visao === "mes" ? "mesesVida" : "dias"} />
        </section>
      ) : (
        <p className="mb-6 text-sm text-[var(--text-muted)]">Nenhuma coleção selecionada tem dados suficientes pra essa curva.</p>
      )}

      {curvaVida.length > 0 && (
        <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Coleção</th>
                <th className="px-4 py-2 font-medium">Lançada em</th>
                <th className="px-4 py-2 font-medium">Estoque restante hoje</th>
              </tr>
            </thead>
            <tbody>
              {curvaVida.map((c, i) => (
                <tr key={c.colecao} className="border-b border-[var(--gridline)] last:border-0">
                  <td className="px-4 py-2 font-medium">
                    <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: CORES_CURVA[i % CORES_CURVA.length] }} />
                    {c.colecao}
                  </td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{formatDataBR(c.primeiraVenda)}</td>
                  <td className="px-4 py-2 tabular-nums">{estoqueRestante(c.pontos[c.pontos.length - 1].percCumulativo).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
