"use client";

import { useState } from "react";
import type { AnaliseGradeResultado } from "@/lib/metrics";
import { formatNumero } from "./format";

// Aba 3 — Análise de Grade. A alternância produto individual ↔ grupo de produtos é estado de
// CLIENTE de propósito (useState, não searchParam): o pedido é trocar "sem sair da aba", e as duas
// visões já vêm calculadas no mesmo payload do servidor — um round-trip por clique de toggle seria
// mais lento sem nenhum ganho.
//
// Nenhuma "grade ideal" fixa aqui: o que a matriz marca como falta é tamanho que AQUELA unidade
// comprovadamente vendeu nos últimos 90 dias e está com 0 hoje (ver montarMatrizGrade). E excesso
// nunca sai de sell-through isolado — vem de estoque vs. velocidade real de venda.
export function AnaliseGrade({ dados }: { dados: AnaliseGradeResultado }) {
  const [visao, setVisao] = useState<"produto" | "grupo">("produto");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Visão da análise de grade">
          {(
            [
              { v: "produto", label: "Produto individual" },
              { v: "grupo", label: "Grupo de produtos" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setVisao(opt.v)}
              aria-pressed={visao === opt.v}
              data-testid={`grade-toggle-${opt.v}`}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                visao === opt.v
                  ? "bg-[var(--series-1)] text-white"
                  : "border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-1)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-[var(--text-muted)]">
          Tamanhos 38/40/42/44 destacados como núcleo — os demais continuam na análise.
        </span>
      </div>

      {visao === "produto" ? <VisaoProduto dados={dados} /> : <VisaoGrupo dados={dados} />}
    </div>
  );
}

function VisaoProduto({ dados }: { dados: AnaliseGradeResultado }) {
  if (dados.porProduto.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-6 text-center text-sm text-[var(--text-muted)]">
        Nenhum produto no filtro atual.
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="grade-visao-produto">
      {dados.porProduto.map((p) => (
        <section
          key={`${p.produto}::${p.cor ?? ""}`}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gridline)] px-4 py-2.5">
            <h3 className="text-sm font-medium text-[var(--text-primary)]">
              {p.produto}
              {p.cor ? <span className="text-[var(--text-muted)]"> · {p.cor}</span> : null}
              <span className="ml-1.5 text-xs font-normal text-[var(--text-muted)]">{p.grupo}</span>
            </h3>
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[var(--text-muted)]">{formatNumero(p.totalGeral)} un. no total</span>
              {p.buracosGrade > 0 && (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{
                    backgroundColor: "color-mix(in srgb, var(--status-critical) 15%, transparent)",
                    color: "var(--status-critical)",
                  }}
                >
                  {p.buracosGrade} buraco(s) de grade
                  {p.buracosGradeNucleo > 0 ? ` · ${p.buracosGradeNucleo} no núcleo` : ""}
                </span>
              )}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] text-left text-[var(--text-muted)]">
                  <th className="px-3 py-1.5 font-medium whitespace-nowrap">Tamanho</th>
                  {dados.colunas.map((c) => (
                    <th key={c.posicaoId} className="px-3 py-1.5 text-right font-medium whitespace-nowrap">
                      {c.posicaoNome}
                    </th>
                  ))}
                  <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Total</th>
                  <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Vd. 90d</th>
                </tr>
              </thead>
              <tbody>
                {p.linhas.map((l) => (
                  <tr key={l.tamanho} className="border-b border-[var(--gridline)] last:border-0">
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className={l.nucleo ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}>
                        {l.tamanho}
                      </span>
                    </td>
                    {l.celulas.map((c) => {
                      const buraco = c.estoque === 0 && c.vendas90 > 0;
                      return (
                        <td
                          key={c.posicaoId}
                          className="px-3 py-1.5 text-right tabular-nums"
                          title={`${c.posicaoNome}: ${c.estoque} un. em estoque · ${c.vendas90} un. vendidas em 90d`}
                          style={{ color: buraco ? "var(--status-critical)" : undefined }}
                        >
                          {buraco ? "0 ⚠" : formatNumero(c.estoque)}
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium text-[var(--text-primary)]">{formatNumero(l.total)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-muted)]">{formatNumero(l.totalVendas90)}</td>
                  </tr>
                ))}
                <tr className="bg-[var(--page-plane)] font-medium">
                  <td className="px-3 py-1.5 text-[var(--text-secondary)]">Total</td>
                  {dados.colunas.map((c) => (
                    <td key={c.posicaoId} className="px-3 py-1.5 text-right tabular-nums text-[var(--text-primary)]">
                      {formatNumero(p.totalPorPosicao.find((t) => t.posicaoId === c.posicaoId)?.estoque ?? 0)}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-primary)]">{formatNumero(p.totalGeral)}</td>
                  <td className="px-3 py-1.5" />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-[var(--text-muted)]">
            ⚠ = a unidade vendeu esse tamanho nos últimos 90 dias e hoje está zerada nele (referência histórica real,
            não grade ideal fixa).
          </p>
        </section>
      ))}
    </div>
  );
}

function VisaoGrupo({ dados }: { dados: AnaliseGradeResultado }) {
  if (dados.porGrupo.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-6 text-center text-sm text-[var(--text-muted)]">
        Nenhum grupo no filtro atual.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="grade-visao-grupo">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="border-b border-[var(--gridline)] px-4 py-2.5">
          <h3 className="text-sm font-medium text-[var(--text-secondary)]">Quadro por grupo de produto</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] text-left text-[var(--text-muted)]">
                <th className="px-3 py-1.5 font-medium whitespace-nowrap">Grupo</th>
                <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Produtos</th>
                <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Qtd. total</th>
                {dados.colunas.map((c) => (
                  <th key={c.posicaoId} className="px-3 py-1.5 text-right font-medium whitespace-nowrap">
                    {c.posicaoNome}
                  </th>
                ))}
                <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Demanda 90d</th>
                <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Excesso est.</th>
                <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Necessidade est.</th>
                <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Oportunidades</th>
              </tr>
            </thead>
            <tbody>
              {dados.porGrupo.map((g) => (
                <tr key={g.grupo} className="border-b border-[var(--gridline)] last:border-0">
                  <td className="px-3 py-1.5 whitespace-nowrap font-medium text-[var(--text-primary)]">{g.grupo}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">{formatNumero(g.produtos)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">{formatNumero(g.quantidadeTotal)}</td>
                  {dados.colunas.map((c) => (
                    <td key={c.posicaoId} className="px-3 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">
                      {formatNumero(g.porPosicao.find((p) => p.posicaoId === c.posicaoId)?.estoque ?? 0)}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">{formatNumero(g.demanda90)}</td>
                  <td
                    className="px-3 py-1.5 text-right tabular-nums"
                    style={{ color: g.excessoEstimado > 0 ? "var(--status-warning)" : undefined }}
                  >
                    {formatNumero(g.excessoEstimado)}
                  </td>
                  <td
                    className="px-3 py-1.5 text-right tabular-nums"
                    style={{ color: g.necessidadeEstimada > 0 ? "var(--status-critical)" : undefined }}
                  >
                    {formatNumero(g.necessidadeEstimada)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">{formatNumero(g.oportunidades)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="border-b border-[var(--gridline)] px-4 py-2.5">
          <h3 className="text-sm font-medium text-[var(--text-secondary)]">Distribuição por tamanho dentro de cada grupo</h3>
        </div>
        <div className="divide-y divide-[var(--gridline)]">
          {dados.porGrupo.map((g) => (
            <div key={g.grupo} className="px-4 py-2.5">
              <div className="mb-1 text-xs font-medium text-[var(--text-primary)]">{g.grupo}</div>
              <div className="flex flex-wrap gap-1.5">
                {g.porTamanho.map((t) => (
                  <span
                    key={t.tamanho}
                    title={`${t.estoque} un. em estoque · ${t.vendas90} un. vendidas em 90d`}
                    className={`rounded px-1.5 py-0.5 text-[11px] tabular-nums ring-1 ring-[var(--gridline)] ${
                      t.nucleo ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                    }`}
                  >
                    {t.tamanho}: {formatNumero(t.estoque)}
                    <span className="text-[var(--text-muted)]"> / {formatNumero(t.vendas90)} vd.</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
