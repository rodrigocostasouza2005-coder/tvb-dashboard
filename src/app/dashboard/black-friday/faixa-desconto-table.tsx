"use client";

import { useState } from "react";
import type { FaixaDescontoRow } from "@/lib/metrics";
import { formatBRL, formatNumber } from "@/lib/format";

// Painel "vendas por faixa de desconto real" (pedido do Rodrigo, 2026-11-06) — cruza venda
// líquida do período com o desconto REAL cadastrado por produto na planilha de preços da Black
// Friday (ver getVendasPorFaixaDesconto em black-friday.ts). Produto vendido sem linha
// correspondente na planilha conta como 0% (pedido explícito do Rodrigo: "se não tem desconto
// cadastrado = 0%") e é somado DENTRO da mesma faixa 0% real, não numa linha própria — por isso
// não existe mais nenhuma linha/estilo de "sem cadastro" aqui.
//
// Dropdown "melhores produtos de cada %" (mesmo pedido): client component porque precisa de
// onChange, mas sem nenhum fetch adicional — `rows[].produtos` já vem pronto do server (mesma
// venda líquida que monta a linha agregada), só filtra em memória qual faixa mostrar.
export function FaixaDescontoTable({ rows, showFinancials }: { rows: FaixaDescontoRow[]; showFinancials: boolean }) {
  const totalUnidades = rows.reduce((s, r) => s + r.unitsSold, 0);
  const totalReceita = rows.reduce((s, r) => s + r.revenue, 0);

  // Default: a faixa de maior receita líquida no período — é a mais relevante pra olhar primeiro
  // (se não houver nenhuma faixa ainda, cai pra null e o dropdown fica vazio).
  const faixaMaiorReceita = rows.length > 0 ? [...rows].sort((a, b) => b.revenue - a.revenue)[0].desconto : null;
  const [selecionada, setSelecionada] = useState<number | null>(faixaMaiorReceita);

  const faixaSelecionada = rows.find((r) => r.desconto === selecionada);
  const produtos = faixaSelecionada?.produtos ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Desconto</th>
              <th className="px-4 py-2 font-medium text-right">Peças líquidas</th>
              <th className="px-4 py-2 font-medium text-right">Produtos distintos</th>
              {showFinancials && <th className="px-4 py-2 font-medium text-right">Receita líquida</th>}
              {showFinancials && <th className="px-4 py-2 font-medium text-right">Preço médio líquido</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.desconto} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                <td className="px-4 py-2 font-medium">{r.label}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.unitsSold)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.produtosDistintos)}</td>
                {showFinancials && <td className="px-4 py-2 text-right tabular-nums">{formatBRL(r.revenue)}</td>}
                {showFinancials && (
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                    {r.precoMedioLiquido != null ? formatBRL(r.precoMedioLiquido) : "—"}
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={showFinancials ? 5 : 3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Nenhuma faixa de desconto cadastrada ainda.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-[var(--gridline)] font-medium">
                <td className="px-4 py-2">Soma das {rows.length} faixas acima</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(totalUnidades)}</td>
                <td className="px-4 py-2 text-right" />
                {showFinancials && <td className="px-4 py-2 text-right tabular-nums">{formatBRL(totalReceita)}</td>}
                {showFinancials && <td className="px-4 py-2 text-right" />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="faixaDescontoProdutos" className="text-xs font-medium text-[var(--text-muted)]">
            Melhores produtos da faixa:
          </label>
          <select
            id="faixaDescontoProdutos"
            value={selecionada ?? ""}
            onChange={(e) => setSelecionada(e.target.value === "" ? null : Number(e.target.value))}
            disabled={rows.length === 0}
            className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
            style={{ colorScheme: "light dark" }}
          >
            {rows.length === 0 && <option value="">—</option>}
            {rows.map((r) => (
              <option key={r.desconto} value={r.desconto}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--gridline)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Produto</th>
                <th className="px-4 py-2 font-medium">Grupo</th>
                <th className="px-4 py-2 font-medium text-right">Peças líquidas</th>
                {showFinancials && <th className="px-4 py-2 font-medium text-right">Receita líquida</th>}
              </tr>
            </thead>
            <tbody>
              {produtos.map((p) => (
                <tr key={`${p.grupo}::${p.produto}`} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{p.produto}</td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">{p.grupo}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNumber(p.unitsSold)}</td>
                  {showFinancials && <td className="px-4 py-2 text-right tabular-nums">{formatBRL(p.revenue)}</td>}
                </tr>
              ))}
              {produtos.length === 0 && (
                <tr>
                  <td colSpan={showFinancials ? 4 : 3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Nenhum produto vendido nesta faixa no período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
