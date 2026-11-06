"use client";

import { useState } from "react";
import type { Top20ProdutoDesconto } from "@/lib/metrics";
import { formatBRL, formatNumber, formatPercent } from "@/lib/format";

// Painel "Top 20 produtos com desconto real" (pedido do Rodrigo, 2026-11-06, corrigido 2x no
// mesmo dia: 1ª vez "o top 20 produtos é produto, não tamanho" — era agrupado por SKU, virou
// grupo+produto; 2ª vez simplificado pra só unidades/faturamento/% desconto — ele não quer ver
// preço cheio/preço com desconto, só o essencial). Desconto vem do CADASTRADO na planilha de BF
// (PrecoBlackFriday), nunca calculado.
//
// Toggle "ordenar por" é só client-side: reordena as mesmas 20 linhas já trazidas do servidor
// (ordenadas por receita por padrão) — não busca um novo top-20-por-unidades no banco.
export function Top20DescontoTable({ rows, showFinancials }: { rows: Top20ProdutoDesconto[]; showFinancials: boolean }) {
  const [ordenarPor, setOrdenarPor] = useState<"revenue" | "unidades">("revenue");

  const ordenadas = [...rows].sort((a, b) =>
    ordenarPor === "unidades" ? b.unitsSold - a.unitsSold : b.revenue - a.revenue
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[var(--text-muted)]">Ordenar por:</span>
        <div className="inline-flex rounded-md border border-[var(--border)] overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setOrdenarPor("revenue")}
            className={`px-2.5 py-1 font-medium ${
              ordenarPor === "revenue"
                ? "bg-[var(--series-1)] text-white"
                : "bg-[var(--surface-1)] text-[var(--text-secondary)]"
            }`}
            disabled={!showFinancials}
            title={!showFinancials ? "Requer permissão pra ver dado financeiro" : undefined}
          >
            Faturamento
          </button>
          <button
            type="button"
            onClick={() => setOrdenarPor("unidades")}
            className={`px-2.5 py-1 font-medium border-l border-[var(--border)] ${
              ordenarPor === "unidades"
                ? "bg-[var(--series-1)] text-white"
                : "bg-[var(--surface-1)] text-[var(--text-secondary)]"
            }`}
          >
            Unidades
          </button>
        </div>
      </div>

      <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-4 py-2 font-medium">Produto</th>
              <th className="px-4 py-2 font-medium text-right">Unidades</th>
              {showFinancials && <th className="px-4 py-2 font-medium text-right">Faturamento</th>}
              {showFinancials && <th className="px-4 py-2 font-medium text-right">% desconto</th>}
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((r, i) => (
              <tr key={`${r.grupo}::${r.produto}`} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                <td className="px-4 py-2 text-[var(--text-muted)]">{i + 1}</td>
                <td className="px-4 py-2">
                  <div className="font-medium text-[var(--text-primary)]">{r.produto}</div>
                  <div className="text-xs text-[var(--text-muted)]">{r.grupo}</div>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.unitsSold)}</td>
                {showFinancials && <td className="px-4 py-2 text-right tabular-nums">{formatBRL(r.revenue)}</td>}
                {showFinancials && (
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.descontoPct != null ? (
                      <span className={r.descontoPct > 0 ? "text-[var(--status-warning)]" : "text-[var(--text-secondary)]"}>
                        {formatPercent(r.descontoPct)}
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)]" title="Produto sem desconto cadastrado na planilha de Black Friday">
                        indisponível
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {ordenadas.length === 0 && (
              <tr>
                <td colSpan={showFinancials ? 5 : 3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Sem venda no período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
