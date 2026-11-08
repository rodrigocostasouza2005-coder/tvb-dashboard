"use client";

import { useState } from "react";
import type { Top20ProdutoDesconto, Top20GrupoDesconto } from "@/lib/metrics";
import { formatBRL, formatNumber, formatPercent } from "@/lib/format";

// Painel "Top 20 produtos com desconto real" (pedido do Rodrigo, 2026-11-06, corrigido 2x no
// mesmo dia: 1ª vez "o top 20 produtos é produto, não tamanho" — era agrupado por SKU, virou
// grupo+produto; 2ª vez simplificado pra só unidades/faturamento/% desconto). Desconto vem do
// CADASTRADO na planilha de BF (PrecoBlackFriday), nunca calculado.
//
// Pedido novo em 2026-11-08: botão pra escolher ver "por produto" ou "por grupo de produto" — as
// duas listas (já top-20 cada, por receita/unidades) vêm prontas do servidor (sem round-trip
// novo ao trocar o toggle); por grupo, o desconto vira MÉDIA ponderada por receita só entre os
// produtos do grupo que têm desconto cadastrado (ver montarTop20GruposComDesconto, black-
// friday.ts) — grupo sem nenhum produto cadastrado mostra indisponível, nunca 0%/média fabricada.
//
// Toggle "ordenar por" é só client-side: reordena as mesmas 20 linhas já trazidas do servidor
// (ordenadas por receita por padrão) — não busca um novo top-20-por-unidades no banco.
export function Top20DescontoTable({
  rowsPorProduto,
  rowsPorGrupo,
  showFinancials,
}: {
  rowsPorProduto: Top20ProdutoDesconto[];
  rowsPorGrupo: Top20GrupoDesconto[];
  showFinancials: boolean;
}) {
  const [visao, setVisao] = useState<"produto" | "grupo">("produto");
  const [ordenarPor, setOrdenarPor] = useState<"revenue" | "unidades">("revenue");

  const ordenarFn = <T extends { unitsSold: number; revenue: number }>(rows: T[]) =>
    [...rows].sort((a, b) => (ordenarPor === "unidades" ? b.unitsSold - a.unitsSold : b.revenue - a.revenue));

  const produtosOrdenados = visao === "produto" ? ordenarFn(rowsPorProduto) : [];
  const gruposOrdenados = visao === "grupo" ? ordenarFn(rowsPorGrupo) : [];
  const vazio = visao === "produto" ? produtosOrdenados.length === 0 : gruposOrdenados.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--text-muted)]">Ver por:</span>
          <div className="inline-flex rounded-md border border-[var(--border)] overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setVisao("produto")}
              className={`px-2.5 py-1 font-medium ${
                visao === "produto" ? "bg-[var(--series-1)] text-white" : "bg-[var(--surface-1)] text-[var(--text-secondary)]"
              }`}
            >
              Produto
            </button>
            <button
              type="button"
              onClick={() => setVisao("grupo")}
              className={`px-2.5 py-1 font-medium border-l border-[var(--border)] ${
                visao === "grupo" ? "bg-[var(--series-1)] text-white" : "bg-[var(--surface-1)] text-[var(--text-secondary)]"
              }`}
            >
              Grupo de produto
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
      </div>

      <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-4 py-2 font-medium">{visao === "produto" ? "Produto" : "Grupo"}</th>
              <th className="px-4 py-2 font-medium text-right">Unidades</th>
              {showFinancials && <th className="px-4 py-2 font-medium text-right">Faturamento</th>}
              {showFinancials && (
                <th className="px-4 py-2 font-medium text-right">{visao === "produto" ? "% desconto" : "% desconto médio"}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {visao === "produto"
              ? produtosOrdenados.map((r, i) => (
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
                ))
              : gruposOrdenados.map((r, i) => (
                  <tr key={r.grupo} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                    <td className="px-4 py-2 text-[var(--text-muted)]">{i + 1}</td>
                    <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{r.grupo}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.unitsSold)}</td>
                    {showFinancials && <td className="px-4 py-2 text-right tabular-nums">{formatBRL(r.revenue)}</td>}
                    {showFinancials && (
                      <td className="px-4 py-2 text-right tabular-nums">
                        {r.descontoMedioPct != null ? (
                          <span className={r.descontoMedioPct > 0 ? "text-[var(--status-warning)]" : "text-[var(--text-secondary)]"}>
                            {formatPercent(r.descontoMedioPct)}
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]" title="Nenhum produto deste grupo tem desconto cadastrado na planilha de Black Friday">
                            indisponível
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
            {vazio && (
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
