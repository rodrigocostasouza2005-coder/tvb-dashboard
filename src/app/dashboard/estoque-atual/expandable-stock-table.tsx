"use client";

import { Fragment, useState } from "react";

type Row = { key: string; quantidade: number; valorCusto: number };
type ProdutoRow = { grupo: string; key: string; quantidade: number; valorCusto: number };

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function ExpandableStockTable({
  rows,
  produtoRows,
  totalQuantidade,
  showFinancials,
}: {
  rows: Row[];
  produtoRows: ProdutoRow[];
  totalQuantidade: number;
  showFinancials: boolean;
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
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Grupo</th>
            <th className="px-4 py-2 font-medium">Quantidade</th>
            <th className="px-4 py-2 font-medium">% do total</th>
            {showFinancials && <th className="px-4 py-2 font-medium">Valor de custo</th>}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((r) => {
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
                  <td className="px-4 py-2 tabular-nums">{r.quantidade.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
                    {totalQuantidade > 0 ? `${((r.quantidade / totalQuantidade) * 100).toFixed(1)}%` : "—"}
                  </td>
                  {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(r.valorCusto)}</td>}
                </tr>
                {isOpen &&
                  produtos.map((p) => (
                    <tr key={`${r.key}::${p.key}`} className="border-b border-[var(--gridline)] bg-[var(--page-plane)] last:border-0">
                      <td className="py-1.5 pr-4 pl-10 text-[var(--text-secondary)]">{p.key}</td>
                      <td className="px-4 py-1.5 tabular-nums text-[var(--text-secondary)]">
                        {p.quantidade.toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-1.5 tabular-nums text-[var(--text-muted)]">
                        {totalQuantidade > 0 ? `${((p.quantidade / totalQuantidade) * 100).toFixed(1)}%` : "—"}
                      </td>
                      {showFinancials && (
                        <td className="px-4 py-1.5 tabular-nums text-[var(--text-secondary)]">{formatBRL(p.valorCusto)}</td>
                      )}
                    </tr>
                  ))}
              </Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={showFinancials ? 4 : 3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                Sem estoque pro filtro selecionado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
