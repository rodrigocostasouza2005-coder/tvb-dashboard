"use client";

import { useMemo, useState } from "react";
import { StatTile } from "../stat-tile";
import type { PromotionRow } from "@/lib/metrics";

type DescontoModo = "recomendado" | "sem" | "+5" | "+10" | "+15" | "personalizado";

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function formatPct(v: number) {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
function formatNum(v: number) {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

// Aplica o modo de desconto escolhido no simulador em cima do desconto RECOMENDADO de cada linha
// (a regra real, vinda da planilha auditada) — "+5/+10/+15" soma pontos percentuais ao
// recomendado, "sem" zera, "personalizado" ignora o recomendado e usa o valor digitado.
function descontoEfetivo(row: PromotionRow, modo: DescontoModo, personalizado: number): number {
  switch (modo) {
    case "sem": return 0;
    case "+5": return Math.min(row.desconto + 0.05, 0.95);
    case "+10": return Math.min(row.desconto + 0.10, 0.95);
    case "+15": return Math.min(row.desconto + 0.15, 0.95);
    case "personalizado": return Math.min(Math.max(personalizado / 100, 0), 0.95);
    default: return row.desconto;
  }
}

type Linha = PromotionRow & {
  descontoAplicado: number;
  precoPromoAplicado: number | null;
  valorEstoquePromoAplicado: number;
};

function aplicarDesconto(rows: PromotionRow[], modo: DescontoModo, personalizado: number): Linha[] {
  return rows.map((r) => {
    const d = descontoEfetivo(r, modo, personalizado);
    const precoPromoAplicado = r.precoCheio !== null ? r.precoCheio * (1 - d) : null;
    return {
      ...r,
      descontoAplicado: d,
      precoPromoAplicado,
      valorEstoquePromoAplicado: precoPromoAplicado !== null ? r.estoque * precoPromoAplicado : 0,
    };
  });
}

function somaPonderada(rows: Linha[], pctVendido: number) {
  const estoqueTotal = rows.reduce((s, r) => s + r.estoque, 0);
  const valorCheio = rows.reduce((s, r) => s + r.valorEstoqueCheio, 0);
  const valorPromo = rows.reduce((s, r) => s + r.valorEstoquePromoAplicado, 0);
  const receitaPotencial = valorPromo * (pctVendido / 100);
  const unidadesPotenciais = estoqueTotal * (pctVendido / 100);
  const descontoMedio = valorCheio > 0 ? 1 - valorPromo / valorCheio : 0;
  const valorDescontoConcedido = valorCheio - valorPromo;
  const comSellThrough = rows.filter((r) => r.sellThroughRate !== null);
  const sellThroughMedio =
    comSellThrough.length > 0
      ? comSellThrough.reduce((s, r) => s + (r.sellThroughRate ?? 0) * r.estoque, 0) /
        (comSellThrough.reduce((s, r) => s + r.estoque, 0) || 1)
      : 0;
  return { estoqueTotal, valorCheio, valorPromo, receitaPotencial, unidadesPotenciais, descontoMedio, valorDescontoConcedido, sellThroughMedio };
}

const CAMPANHAS_PRESET = ["Black Friday 2026", "Liquidação", "Promoção"];

export function PromocaoClient({ rows }: { rows: PromotionRow[] }) {
  const [campanha, setCampanha] = useState(CAMPANHAS_PRESET[0]);
  const [colecaoSel, setColecaoSel] = useState<string>("");
  const [grupoSel, setGrupoSel] = useState<string>("");
  const [produtoSel, setProdutoSel] = useState<string>("");
  const [pctVendido, setPctVendido] = useState(40);
  const [descontoModo, setDescontoModo] = useState<DescontoModo>("recomendado");
  const [descontoPersonalizado, setDescontoPersonalizado] = useState(20);
  const [ordenacao, setOrdenacao] = useState<"receita" | "estoque" | "sellthrough" | "desconto">("receita");

  const coleções = useMemo(() => [...new Set(rows.map((r) => r.colecao))].sort(), [rows]);
  const gruposDaColecao = useMemo(
    () => [...new Set(rows.filter((r) => !colecaoSel || r.colecao === colecaoSel).map((r) => r.grupo))].sort(),
    [rows, colecaoSel]
  );
  const produtosDoGrupo = useMemo(
    () =>
      [...new Set(
        rows
          .filter((r) => (!colecaoSel || r.colecao === colecaoSel) && (!grupoSel || r.grupo === grupoSel))
          .map((r) => r.produto)
      )].sort(),
    [rows, colecaoSel, grupoSel]
  );

  const filtradas = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!colecaoSel || r.colecao === colecaoSel) &&
          (!grupoSel || r.grupo === grupoSel) &&
          (!produtoSel || r.produto === produtoSel)
      ),
    [rows, colecaoSel, grupoSel, produtoSel]
  );

  const linhas = useMemo(() => aplicarDesconto(filtradas, descontoModo, descontoPersonalizado), [filtradas, descontoModo, descontoPersonalizado]);
  const kpis = useMemo(() => somaPonderada(linhas, pctVendido), [linhas, pctVendido]);

  const linhasOrdenadas = useMemo(() => {
    const copia = [...linhas];
    switch (ordenacao) {
      case "estoque": return copia.sort((a, b) => b.estoque - a.estoque);
      case "sellthrough": return copia.sort((a, b) => (a.sellThroughRate ?? 999) - (b.sellThroughRate ?? 999));
      case "desconto": return copia.sort((a, b) => b.descontoAplicado - a.descontoAplicado);
      default: return copia.sort((a, b) => b.valorEstoquePromoAplicado - a.valorEstoquePromoAplicado);
    }
  }, [linhas, ordenacao]);

  const porColecao = useMemo(() => {
    const map = new Map<string, { estoque: number; valorCheio: number; valorPromo: number; produtos: Set<string> }>();
    for (const r of linhas) {
      const e = map.get(r.colecao) ?? { estoque: 0, valorCheio: 0, valorPromo: 0, produtos: new Set<string>() };
      e.estoque += r.estoque;
      e.valorCheio += r.valorEstoqueCheio;
      e.valorPromo += r.valorEstoquePromoAplicado;
      e.produtos.add(r.produto);
      map.set(r.colecao, e);
    }
    return [...map.entries()]
      .map(([colecao, v]) => ({ colecao, ...v, produtos: v.produtos.size, receitaPotencial: v.valorPromo * (pctVendido / 100) }))
      .sort((a, b) => b.receitaPotencial - a.receitaPotencial);
  }, [linhas, pctVendido]);

  const porGrupo = useMemo(() => {
    const map = new Map<string, { estoque: number; valorCheio: number; valorPromo: number; stCount: number; stSoma: number }>();
    for (const r of linhas) {
      const e = map.get(r.grupo) ?? { estoque: 0, valorCheio: 0, valorPromo: 0, stCount: 0, stSoma: 0 };
      e.estoque += r.estoque;
      e.valorCheio += r.valorEstoqueCheio;
      e.valorPromo += r.valorEstoquePromoAplicado;
      if (r.sellThroughRate !== null) { e.stSoma += r.sellThroughRate; e.stCount += 1; }
      map.set(r.grupo, e);
    }
    return [...map.entries()]
      .map(([grupo, v]) => ({
        grupo, estoque: v.estoque, valorCheio: v.valorCheio,
        descontoMedio: v.valorCheio > 0 ? 1 - v.valorPromo / v.valorCheio : 0,
        receitaPotencial: v.valorPromo * (pctVendido / 100),
        sellThroughMedio: v.stCount > 0 ? v.stSoma / v.stCount : null,
      }))
      .sort((a, b) => b.receitaPotencial - a.receitaPotencial);
  }, [linhas, pctVendido]);

  // Produtos que merecem atenção: estoque financeiro relevante + sell-through baixo (achado
  // objetivo, não "nota" subjetiva — só ordena pelas 2 métricas reais).
  const produtosAtencao = useMemo(() => {
    return [...linhas]
      .filter((r) => r.valorEstoqueCheio > 0 && r.sellThroughRate !== null && r.sellThroughRate < 50)
      .sort((a, b) => b.valorEstoqueCheio - a.valorEstoqueCheio)
      .slice(0, 20);
  }, [linhas]);

  const cenarios = useMemo(() => {
    const calc = (pct: number) => somaPonderada(linhas, pct);
    return [
      { nome: "Conservador", pct: 20, ...calc(20) },
      { nome: "Base", pct: 40, ...calc(40) },
      { nome: "Agressivo", pct: 60, ...calc(60) },
    ];
  }, [linhas]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Análises de Promoção</h1>
          <p className="text-sm text-[var(--text-muted)]">Simulação de estoque, descontos e potencial de receita</p>
        </div>
        <select
          value={campanha}
          onChange={(e) => setCampanha(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
          style={{ colorScheme: "light dark" }}
        >
          {CAMPANHAS_PRESET.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
          <option value="personalizada">Campanha personalizada</option>
        </select>
      </div>

      {/* Filtros hierárquicos — Coleção → Grupo → Produto, listas completas (não bloqueiam Tab), só restringem as OPÇÕES conforme o pai escolhido. */}
      <div className="mb-4 flex flex-wrap gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
        <FiltroSelect label="Coleção" value={colecaoSel} onChange={(v) => { setColecaoSel(v); setGrupoSel(""); setProdutoSel(""); }} options={coleções} />
        <FiltroSelect label="Grupo" value={grupoSel} onChange={(v) => { setGrupoSel(v); setProdutoSel(""); }} options={gruposDaColecao} />
        <FiltroSelect label="Produto" value={produtoSel} onChange={setProdutoSel} options={produtosDoGrupo} />
      </div>

      {/* KPIs principais */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Estoque total" value={formatNum(kpis.estoqueTotal)} />
        <StatTile label="Valor a preço cheio" value={formatBRL(kpis.valorCheio)} />
        <StatTile label="Valor promocional" value={formatBRL(kpis.valorPromo)} />
        <StatTile label="Receita potencial" value={formatBRL(kpis.receitaPotencial)} />
        <StatTile label="Unidades potenciais vendidas" value={formatNum(kpis.unidadesPotenciais)} />
        <StatTile label="Desconto médio" value={formatPct(kpis.descontoMedio * 100)} />
        <StatTile label="Valor de desconto concedido" value={formatBRL(kpis.valorDescontoConcedido)} />
        <StatTile label="Sell-through médio" value={formatPct(kpis.sellThroughMedio)} />
      </div>

      {/* Simulador */}
      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Simulador</h2>
        <div className="flex flex-wrap items-end gap-6">
          <div className="flex min-w-[220px] flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              % do estoque vendido — <span className="text-[var(--text-primary)]">{pctVendido}%</span>
            </label>
            <input
              type="range" min={0} max={100} step={5} value={pctVendido}
              onChange={(e) => setPctVendido(Number(e.target.value))}
              className="w-full accent-[var(--series-1)]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Desconto</label>
            <select
              value={descontoModo}
              onChange={(e) => setDescontoModo(e.target.value as DescontoModo)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
              style={{ colorScheme: "light dark" }}
            >
              <option value="recomendado">Desconto recomendado</option>
              <option value="sem">Sem desconto</option>
              <option value="+5">+5%</option>
              <option value="+10">+10%</option>
              <option value="+15">+15%</option>
              <option value="personalizado">Personalizado</option>
            </select>
          </div>
          {descontoModo === "personalizado" && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">% personalizado</label>
              <input
                type="number" min={0} max={95} value={descontoPersonalizado}
                onChange={(e) => setDescontoPersonalizado(Number(e.target.value))}
                className="w-24 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Receita estimada</span>
            <span className="text-xl font-semibold tabular-nums text-[var(--text-primary)]">{formatBRL(kpis.receitaPotencial)}</span>
          </div>
        </div>
      </section>

      {/* Comparador de cenários */}
      <section className="mb-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <h2 className="border-b border-[var(--gridline)] px-4 py-3 text-sm font-medium text-[var(--text-secondary)]">Cenários</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Métrica</th>
                {cenarios.map((c) => <th key={c.nome} className="px-4 py-2 text-right font-medium">{c.nome} ({c.pct}%)</th>)}
              </tr>
            </thead>
            <tbody>
              <RowCenario label="% estoque vendido" values={cenarios.map((c) => `${c.pct}%`)} />
              <RowCenario label="Desconto médio" values={cenarios.map((c) => formatPct(c.descontoMedio * 100))} />
              <RowCenario label="Unidades vendidas" values={cenarios.map((c) => formatNum(c.unidadesPotenciais))} />
              <RowCenario label="Receita" values={cenarios.map((c) => formatBRL(c.receitaPotencial))} />
              <RowCenario label="Desconto concedido" values={cenarios.map((c) => formatBRL(c.valorDescontoConcedido))} />
            </tbody>
          </table>
        </div>
      </section>

      {/* Análise por Coleção */}
      <section className="mb-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <h2 className="border-b border-[var(--gridline)] px-4 py-3 text-sm font-medium text-[var(--text-secondary)]">Potencial por Coleção</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Coleção</th>
                <th className="px-4 py-2 text-right font-medium">Produtos</th>
                <th className="px-4 py-2 text-right font-medium">Estoque</th>
                <th className="px-4 py-2 text-right font-medium">Receita potencial</th>
              </tr>
            </thead>
            <tbody>
              {porColecao.map((c) => (
                <tr
                  key={c.colecao}
                  onClick={() => setColecaoSel(c.colecao)}
                  className="cursor-pointer border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]"
                >
                  <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{c.colecao}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{c.produtos}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{formatNum(c.estoque)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium text-[var(--text-primary)]">{formatBRL(c.receitaPotencial)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Análise por Grupo */}
      <section className="mb-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <h2 className="border-b border-[var(--gridline)] px-4 py-3 text-sm font-medium text-[var(--text-secondary)]">Potencial por Grupo</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Grupo</th>
                <th className="px-4 py-2 text-right font-medium">Estoque</th>
                <th className="px-4 py-2 text-right font-medium">Sell-through</th>
                <th className="px-4 py-2 text-right font-medium">Desconto médio</th>
                <th className="px-4 py-2 text-right font-medium">Receita potencial</th>
              </tr>
            </thead>
            <tbody>
              {porGrupo.map((g) => (
                <tr
                  key={g.grupo}
                  onClick={() => setGrupoSel(g.grupo)}
                  className="cursor-pointer border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]"
                >
                  <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{g.grupo}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{formatNum(g.estoque)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{g.sellThroughMedio !== null ? formatPct(g.sellThroughMedio) : "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{formatPct(g.descontoMedio * 100)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium text-[var(--text-primary)]">{formatBRL(g.receitaPotencial)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Produtos que merecem atenção */}
      <section className="mb-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <h2 className="border-b border-[var(--gridline)] px-4 py-3 text-sm font-medium text-[var(--text-secondary)]">Produtos que merecem atenção</h2>
        <p className="px-4 pt-2 text-xs text-[var(--text-muted)]">Estoque financeiro relevante + sell-through abaixo de 50%, ordenado por valor de estoque.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Produto</th>
                <th className="px-4 py-2 text-right font-medium">Estoque</th>
                <th className="px-4 py-2 text-right font-medium">Sell-through</th>
                <th className="px-4 py-2 text-right font-medium">Valor estoque</th>
                <th className="px-4 py-2 text-right font-medium">Desc. recomendado</th>
                <th className="px-4 py-2 text-right font-medium">Receita potencial</th>
              </tr>
            </thead>
            <tbody>
              {produtosAtencao.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">Nenhum produto encontrado para os filtros selecionados.</td></tr>
              ) : produtosAtencao.map((r) => (
                <tr key={`${r.grupo}-${r.produto}-${r.colecao}`} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{r.produto}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{formatNum(r.estoque)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{r.sellThroughRate !== null ? formatPct(r.sellThroughRate) : "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{formatBRL(r.valorEstoqueCheio)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{formatPct(r.descontoAplicado * 100)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium text-[var(--text-primary)]">{formatBRL(r.valorEstoquePromoAplicado * (pctVendido / 100))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Tabela principal */}
      <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gridline)] px-4 py-3">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">Todos os produtos ({linhasOrdenadas.length})</h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--text-muted)]">Ordenar por</span>
            <select
              value={ordenacao}
              onChange={(e) => setOrdenacao(e.target.value as typeof ordenacao)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-primary)]"
              style={{ colorScheme: "light dark" }}
            >
              <option value="receita">Maior receita potencial</option>
              <option value="estoque">Maior estoque</option>
              <option value="sellthrough">Menor sell-through</option>
              <option value="desconto">Maior desconto</option>
            </select>
          </div>
        </div>
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--page-plane)]">
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Grupo</th>
                <th className="px-4 py-2 font-medium">Produto</th>
                <th className="px-4 py-2 font-medium">Coleção</th>
                <th className="px-4 py-2 text-right font-medium">Preço</th>
                <th className="px-4 py-2 text-right font-medium">Estoque</th>
                <th className="px-4 py-2 text-right font-medium">Sell-through</th>
                <th className="px-4 py-2 text-right font-medium">Desc.</th>
                <th className="px-4 py-2 text-right font-medium">Preço Promo</th>
                <th className="px-4 py-2 text-right font-medium">Valor Estoque</th>
                <th className="px-4 py-2 text-right font-medium">Receita Potencial</th>
              </tr>
            </thead>
            <tbody>
              {linhasOrdenadas.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">Nenhum produto encontrado para os filtros selecionados.</td></tr>
              ) : linhasOrdenadas.map((r) => (
                <tr key={`${r.grupo}-${r.produto}-${r.colecao}`} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 whitespace-nowrap text-[var(--text-secondary)]">{r.grupo}</td>
                  <td className="px-4 py-2 font-medium whitespace-nowrap text-[var(--text-primary)]">{r.produto}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-[var(--text-secondary)]">{r.colecao}</td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap text-[var(--text-secondary)]">{r.precoCheio !== null ? formatBRL(r.precoCheio) : "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{formatNum(r.estoque)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{r.sellThroughRate !== null ? formatPct(r.sellThroughRate) : "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]" title={r.motivoDesconto}>{formatPct(r.descontoAplicado * 100)}</td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap text-[var(--text-secondary)]">{r.precoPromoAplicado !== null ? formatBRL(r.precoPromoAplicado) : "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap text-[var(--text-secondary)]">{formatBRL(r.valorEstoqueCheio)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium whitespace-nowrap text-[var(--text-primary)]">{formatBRL(r.valorEstoquePromoAplicado * (pctVendido / 100))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function FiltroSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-[160px] rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
        style={{ colorScheme: "light dark" }}
      >
        <option value="">Todas</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function RowCenario({ label, values }: { label: string; values: string[] }) {
  return (
    <tr className="border-b border-[var(--gridline)] last:border-0">
      <td className="px-4 py-2 text-[var(--text-secondary)]">{label}</td>
      {values.map((v, i) => <td key={i} className="px-4 py-2 text-right tabular-nums font-medium text-[var(--text-primary)]">{v}</td>)}
    </tr>
  );
}
