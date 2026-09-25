import { getSessionUser } from "@/lib/auth";
import {
  getSellthroughByColecao,
  getColecaoCurvaVida,
  getCurvaVidaGrupoEProduto,
  getColecoes,
  getStores,
  getMarcas,
  getTabelasPreco,
} from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestrictionSemAtacado } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { CohortTable, type CohortGradeRow } from "./cohort-table";

const JANELA_DIA = 30; // cohort dia a dia: 1 mês de vida, célula a célula já fica bem larga
const JANELA_MES = 360; // cohort mês a mês: 12 meses de 30 dias

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
  const allowedTabelasPreco = getTabelaPrecoRestrictionSemAtacado(user);
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
  // aconteceram. `valor` só depende de `pontos`, então é reaproveitado tal e qual pros níveis
  // Grupo e Produto (2026-09-23) — cada nível tem sua própria janela de pontos (D0 = 1ª venda
  // DAQUELE nível), a função de coluna é a mesma.
  type NodePontos = { pontos: { dias: number; percPeriodo: number; percCumulativo: number }[] };
  const colunas =
    visao === "dia"
      ? Array.from({ length: JANELA_DIA + 1 }, (_, dias) => ({
          label: `D${dias}`,
          valor: (c: NodePontos) => (dias < c.pontos.length ? c.pontos[dias].percPeriodo : null),
        }))
      : Array.from({ length: JANELA_MES / 30 }, (_, i) => {
          const mes = i + 1;
          const diaInicio = i * 30;
          const diaFim = mes * 30 - 1;
          return {
            label: `M${mes}`,
            valor: (c: NodePontos) => {
              if (diaInicio > c.pontos.length - 1) return null;
              const diasDoMes = c.pontos.slice(diaInicio, Math.min(diaFim, c.pontos.length - 1) + 1);
              return diasDoMes.reduce((s, p) => s + p.percPeriodo, 0);
            },
          };
        });

  function paraLinhaGrade(key: string, c: NodePontos & { primeiraVenda: string }): CohortGradeRow {
    return {
      key,
      primeiraVenda: c.primeiraVenda,
      totalHoje: c.pontos[c.pontos.length - 1].percCumulativo,
      celulas: colunas.map((col) => col.valor(c)),
    };
  }

  const grade = curvaVida.map((c) => paraLinhaGrade(c.colecao, c));

  // Grupo/Produto: computados só pras coleções que sobraram na `grade` (já filtradas por terem
  // dado suficiente), pra não gastar query com coleção que nem apareceu na tabela.
  const { grupos: grupoCurvaMap, produtos: produtoCurvaMap } = await getCurvaVidaGrupoEProduto(
    filters,
    grade.map((g) => g.key),
    janela
  );

  const grupoGrid: Record<string, CohortGradeRow[]> = {};
  for (const [colecao, nodes] of grupoCurvaMap) {
    grupoGrid[colecao] = nodes.map((n) => paraLinhaGrade(n.key, n));
  }

  const produtoGrid: Record<string, CohortGradeRow[]> = {};
  for (const [grupoKey, nodes] of produtoCurvaMap) {
    produtoGrid[grupoKey] = nodes.map((n) => paraLinhaGrade(n.key, n));
  }

  // Mesma escala de cor nos 3 níveis (ver src/lib/cohort-color.ts) — calculada sobre TODAS as
  // células dos 3 níveis, não só a linha de Coleção, senão expandir um grupo/produto mudaria a
  // intensidade das cores já visíveis na coleção.
  const maxValor = Math.max(
    0,
    ...grade.flatMap((g) => g.celulas.filter((v): v is number => v !== null)),
    ...Object.values(grupoGrid).flatMap((rows) => rows.flatMap((r) => r.celulas.filter((v): v is number => v !== null))),
    ...Object.values(produtoGrid).flatMap((rows) => rows.flatMap((r) => r.celulas.filter((v): v is number => v !== null)))
  );

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
        <CohortTable
          colecaoRows={grade}
          grupoGrid={grupoGrid}
          produtoGrid={produtoGrid}
          colunaLabels={colunas.map((col) => col.label)}
          maxValor={maxValor}
        />
      ) : (
        <p className="mb-6 text-sm text-[var(--text-muted)]">Nenhuma coleção selecionada tem dados suficientes pra essa curva.</p>
      )}
    </div>
  );
}
