"use client";

import { useState } from "react";
import type { VariacaoGrupoRow } from "@/lib/metrics";

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function formatNum(v: number) {
  return v.toLocaleString("pt-BR");
}
function formatPct(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

// Verde/vermelho só a partir de uma variação minimamente relevante — abaixo disso é "estável"
// (cinza neutro), senão qualquer ruído de arredondamento pintaria a barra de uma cor ou outra.
const LIMIAR_ESTAVEL_PCT = 1;

function corDaVariacao(pct: number | null): string {
  if (pct === null || Math.abs(pct) < LIMIAR_ESTAVEL_PCT) return "var(--text-muted)";
  return pct > 0 ? "var(--status-good)" : "var(--status-critical)";
}

// Gráfico de barras horizontais divergentes (eixo zero central) — pedido do Rodrigo em
// 2026-10-13. Usa os MESMOS tokens de cor do resto do Radar (--surface-1/--text-*/--status-*) —
// segue o tema claro/escuro do site normalmente, igual qualquer outro card (pedido do Rodrigo em
// 2026-10-13: a versão inicial tinha fundo preto fixo "estilo terminal", ele preferiu consistente
// com o resto da tela).
export function VariacaoGrupoChart({ rows }: { rows: VariacaoGrupoRow[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center rounded-lg text-sm text-[var(--text-muted)]">
        Sem receita líquida no período/filtro selecionado pra comparar.
      </div>
    );
  }

  const comPercentual = rows.filter((r) => r.variacaoPercentual !== null).map((r) => Math.abs(r.variacaoPercentual!));
  // Fallback 100 se TODOS os grupos forem "novo"/"sem base" (nenhum percentual real pra escalar) —
  // só evita divisão por zero, não aparece nenhuma barra colorida nesse caso de qualquer jeito.
  const maxAbsPct = Math.max(...comPercentual, 1);
  const rowHeight = 34;
  const height = Math.min(rows.length * rowHeight + 16, 560);

  return (
    <div className="rounded-lg p-4 font-mono text-xs text-[var(--text-primary)]">
      <div className="relative overflow-y-auto" style={{ height }}>
        {/* Grade vertical discreta + eixo zero central */}
        <div className="pointer-events-none absolute inset-0 left-[0] right-0" style={{ marginLeft: "min(42%, 220px)" }}>
          {[-100, -50, 0, 50, 100].map((marca) => (
            <div
              key={marca}
              className="absolute top-0 bottom-0 w-px"
              style={{
                left: `${50 + (marca / 100) * 50}%`,
                background: marca === 0 ? "var(--text-muted)" : "var(--gridline)",
              }}
            />
          ))}
        </div>

        {rows.map((r, i) => {
          const pct = r.variacaoPercentual;
          const frac = pct !== null ? Math.min(Math.abs(pct) / maxAbsPct, 1) * 0.5 : 0;
          const cor = corDaVariacao(pct);
          const label =
            r.status === "sem_base" ? "Sem base" : r.status === "novo" ? "Novo" : formatPct(pct!);

          return (
            <div
              key={r.grupo}
              className="relative flex items-center gap-2"
              style={{ height: rowHeight }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            >
              <div
                className="shrink-0 truncate pr-2 text-[var(--text-primary)]"
                style={{ width: "min(42%, 220px)" }}
                title={r.grupo}
              >
                {r.grupo}
              </div>
              <div className="relative h-5 flex-1">
                {/* barra: parte do centro (50%), estende left ou right conforme o sinal */}
                <div
                  className="absolute top-0 h-full rounded-sm"
                  style={{
                    left: pct !== null && pct < 0 ? `${50 - frac * 100}%` : "50%",
                    width: `${frac * 100}%`,
                    background: cor,
                    opacity: hover === null || hover === i ? 1 : 0.35,
                  }}
                />
                <span
                  className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px]"
                  style={{
                    left: pct !== null && pct < 0 ? `calc(${50 - frac * 100}% - 6px)` : `calc(${50 + frac * 100}% + 6px)`,
                    transform: `translateY(-50%) ${pct !== null && pct < 0 ? "translateX(-100%)" : ""}`,
                    color: r.status === "normal" ? cor : "var(--text-muted)",
                  }}
                >
                  {label}
                </span>
              </div>

              {hover === i && (
                <div
                  className="absolute right-0 top-full z-10 mt-1 w-64 rounded border border-[var(--border)] bg-[var(--surface-1)] p-2 text-[11px] text-[var(--text-primary)] shadow-lg"
                >
                  <div className="mb-1 font-semibold">{r.grupo}</div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                    <span className="text-[var(--text-muted)]">Receita líquida atual</span>
                    <span className="text-right tabular-nums">{formatBRL(r.receitaAtual)}</span>
                    <span className="text-[var(--text-muted)]">Receita líquida anterior</span>
                    <span className="text-right tabular-nums">{formatBRL(r.receitaAnterior)}</span>
                    <span className="text-[var(--text-muted)]">Variação absoluta</span>
                    <span className="text-right tabular-nums">{formatBRL(r.variacaoAbsoluta)}</span>
                    <span className="text-[var(--text-muted)]">Variação %</span>
                    <span className="text-right tabular-nums">
                      {r.status === "normal" ? formatPct(pct!) : label}
                    </span>
                    <span className="text-[var(--text-muted)]">Unidades (atual/ant.)</span>
                    <span className="text-right tabular-nums">
                      {formatNum(r.unidadesAtual)} / {formatNum(r.unidadesAnterior)}
                    </span>
                    {(r.margemAtual !== null || r.margemAnterior !== null) && (
                      <>
                        <span className="text-[var(--text-muted)]">Margem bruta (atual/ant.)</span>
                        <span className="text-right tabular-nums">
                          {r.margemAtual !== null ? `${r.margemAtual.toFixed(1)}%` : "—"} /{" "}
                          {r.margemAnterior !== null ? `${r.margemAnterior.toFixed(1)}%` : "—"}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
