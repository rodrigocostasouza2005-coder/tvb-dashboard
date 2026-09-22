import { getSessionUser } from "@/lib/auth";
import { getSellthroughByColecao, getColecaoCurvaVida, getColecoes, getStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";

const JANELA_DIA = 30; // cohort dia a dia: 1 mês de vida, célula a célula já fica bem larga
const JANELA_MES = 360; // cohort mês a mês: 12 meses de 30 dias

function formatDataBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Intensidade relativa ao maior valor visível na tabela agora (não um limiar fixo) — assim a
// mesma escala de cor funciona tanto pra visão dia (valores pequenos, tipo 2-4%) quanto mês
// (valores maiores, tipo 15-25%), sem precisar de 2 paletas diferentes.
function corCelula(valor: number | null, max: number): { bg: string; fg: string } {
  if (valor === null) return { bg: "transparent", fg: "var(--text-muted)" };
  if (valor <= 0 || max <= 0) return { bg: "var(--map-empty)", fg: "var(--text-muted)" };
  const frac = valor / max;
  if (frac < 0.2) return { bg: "var(--seq-1)", fg: "var(--text-primary)" };
  if (frac < 0.4) return { bg: "var(--seq-2)", fg: "var(--text-primary)" };
  if (frac < 0.6) return { bg: "var(--seq-3)", fg: "var(--text-primary)" };
  if (frac < 0.8) return { bg: "var(--seq-4)", fg: "#ffffff" };
  return { bg: "var(--seq-5)", fg: "#ffffff" };
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

  // Tabela cohort: 1 linha por coleção, 1 coluna por período de vida (dia ou mês desde a 1ª
  // venda) — pedido do Rodrigo em 2026-09-22 ("queria fazer tipo um cohort"). Cada coluna soma o
  // percPeriodo (não acumulado) daquele período; mês ainda em andamento soma só os dias que já
  // aconteceram.
  const colunas =
    visao === "dia"
      ? Array.from({ length: JANELA_DIA + 1 }, (_, dias) => ({
          label: `D${dias}`,
          valor: (c: (typeof curvaVida)[number]) => (dias < c.pontos.length ? c.pontos[dias].percPeriodo : null),
        }))
      : Array.from({ length: JANELA_MES / 30 }, (_, i) => {
          const mes = i + 1;
          const diaInicio = i * 30;
          const diaFim = mes * 30 - 1;
          return {
            label: `M${mes}`,
            valor: (c: (typeof curvaVida)[number]) => {
              if (diaInicio > c.pontos.length - 1) return null;
              const diasDoMes = c.pontos.slice(diaInicio, Math.min(diaFim, c.pontos.length - 1) + 1);
              return diasDoMes.reduce((s, p) => s + p.percPeriodo, 0);
            },
          };
        });

  const grade = curvaVida.map((c) => ({
    colecao: c.colecao,
    primeiraVenda: c.primeiraVenda,
    totalHoje: c.pontos[c.pontos.length - 1].percCumulativo,
    celulas: colunas.map((col) => col.valor(c)),
  }));

  const maxValor = Math.max(0, ...grade.flatMap((g) => g.celulas.filter((v): v is number => v !== null)));

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
        Cohort: cada linha é uma coleção, cada coluna é um {visao === "mes" ? "mês" : "dia"} de vida a partir da 1ª venda dela
        (não do calendário) — a célula é o % do estoque+saída total vendido só {visao === "mes" ? "naquele mês" : "naquele dia"},
        não acumulado. Cor mais forte = período mais forte de venda. Aproximado: soma o vendido dia a dia contra o mesmo
        estoque+saída da tabela de Sell-through, sem descontar devolução/brinde dia a dia.
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

      {grade.length > 0 ? (
        <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <table className="text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="sticky left-0 z-10 bg-[var(--surface-1)] px-4 py-2 font-medium">Coleção</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Lançada em</th>
                {colunas.map((col) => (
                  <th key={col.label} className="w-11 px-1 py-2 text-center font-medium">{col.label}</th>
                ))}
                <th className="px-3 py-2 font-medium whitespace-nowrap">Total hoje</th>
              </tr>
            </thead>
            <tbody>
              {grade.map((g) => (
                <tr key={g.colecao} className="border-b border-[var(--gridline)] last:border-0">
                  <td className="sticky left-0 z-10 bg-[var(--surface-1)] px-4 py-2 font-medium whitespace-nowrap">{g.colecao}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-[var(--text-secondary)]">{formatDataBR(g.primeiraVenda)}</td>
                  {g.celulas.map((valor, i) => {
                    const { bg, fg } = corCelula(valor, maxValor);
                    return (
                      <td key={i} className="w-11 px-1 py-2 text-center tabular-nums" style={{ backgroundColor: bg, color: fg }}>
                        {valor !== null ? valor.toFixed(0) : ""}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 tabular-nums font-medium whitespace-nowrap">{g.totalHoje.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mb-6 text-sm text-[var(--text-muted)]">Nenhuma coleção selecionada tem dados suficientes pra essa curva.</p>
      )}
    </div>
  );
}
