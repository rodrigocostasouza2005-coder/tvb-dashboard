"use client";

import { Fragment, useState } from "react";

type Row = { key: string; unitsSold: number; revenue: number };
type ProdutoRow = { grupo: string; key: string; unitsSold: number; revenue: number };

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Clicar na seta de um grupo abre uma sub-lista com os produtos daquele grupo, embaixo da
// linha, sem precisar de nova chamada ao servidor (produtoRows já vem tudo pronto).
export function ExpandableSalesTable({
  rows,
  produtoRows,
  totalUnits,
  showFinancials,
  emptyMessage = "Sem vendas no período/filtro selecionado.",
}: {
  rows: Row[];
  produtoRows: ProdutoRow[];
  totalUnits: number;
  showFinancials: boolean;
  emptyMessage?: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  function toggle(grupo: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(grupo)) next.delete(grupo);
      else next.add(grupo);
      return next;
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Grupo</th>
            <th className="px-4 py-2 font-medium">Unidades</th>
            <th className="px-4 py-2 font-medium">% do total</th>
            {showFinancials && <th className="px-4 py-2 font-medium">Receita</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.has(r.key);
            const produtos = produtoRows.filter((p) => p.grupo === r.key);
            return (
              <Fragment key={r.key}>
                <tr className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium">
                    <button
                      type="button"
                      onClick={() => toggle(r.key)}
                      className="flex items-center gap-2 text-left"
                      disabled={produtos.length === 0}
                    >
                      <span
                        className="inline-block w-3 text-[var(--text-muted)] transition-transform"
                        style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                      >
                        {produtos.length > 0 ? "▸" : ""}
                      </span>
                      {r.key}
                    </button>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{r.unitsSold.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
                    {totalUnits > 0 ? `${((r.unitsSold / totalUnits) * 100).toFixed(1)}%` : "—"}
                  </td>
                  {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(r.revenue)}</td>}
                </tr>
                {isOpen &&
                  produtos.map((p) => (
                    <tr key={`${r.key}::${p.key}`} className="border-b border-[var(--gridline)] bg-[var(--page-plane)] last:border-0">
                      <td className="py-1.5 pr-4 pl-10 text-[var(--text-secondary)]">{p.key}</td>
                      <td className="px-4 py-1.5 tabular-nums text-[var(--text-secondary)]">
                        {p.unitsSold.toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-1.5 tabular-nums text-[var(--text-muted)]">
                        {totalUnits > 0 ? `${((p.unitsSold / totalUnits) * 100).toFixed(1)}%` : "—"}
                      </td>
                      {showFinancials && (
                        <td className="px-4 py-1.5 tabular-nums text-[var(--text-secondary)]">{formatBRL(p.revenue)}</td>
                      )}
                    </tr>
                  ))}
              </Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={showFinancials ? 4 : 3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
