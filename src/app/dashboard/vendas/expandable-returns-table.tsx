"use client";

import { Fragment, useState } from "react";

type Row = { key: string; unitsReturned: number; value: number };
type SubRow = { grupo: string; key: string; unitsReturned: number; value: number };

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function ExpandableReturnsTable({
  rows,
  subRows,
  totalReturned,
  showFinancials,
  parentLabel = "Grupo",
}: {
  rows: Row[];
  subRows: SubRow[];
  totalReturned: number;
  showFinancials: boolean;
  parentLabel?: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">{parentLabel}</th>
            <th className="px-4 py-2 font-medium">Unidades devolvidas</th>
            <th className="px-4 py-2 font-medium">% do total devolvido</th>
            {showFinancials && <th className="px-4 py-2 font-medium">Valor devolvido</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.has(r.key);
            const children = subRows.filter((s) => s.grupo === r.key);
            return (
              <Fragment key={r.key}>
                <tr className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium">
                    <button
                      type="button"
                      onClick={() => toggle(r.key)}
                      className="flex items-center gap-2 text-left"
                      disabled={children.length === 0}
                    >
                      <span
                        className="inline-block w-3 text-[var(--text-muted)] transition-transform"
                        style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                      >
                        {children.length > 0 ? "▸" : ""}
                      </span>
                      {r.key}
                    </button>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{r.unitsReturned.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
                    {totalReturned > 0 ? `${((r.unitsReturned / totalReturned) * 100).toFixed(1)}%` : "—"}
                  </td>
                  {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(r.value)}</td>}
                </tr>
                {isOpen &&
                  children.map((c) => (
                    <tr key={`${r.key}::${c.key}`} className="border-b border-[var(--gridline)] bg-[var(--page-plane)] last:border-0">
                      <td className="py-1.5 pr-4 pl-10 text-[var(--text-secondary)]">{c.key}</td>
                      <td className="px-4 py-1.5 tabular-nums text-[var(--text-secondary)]">
                        {c.unitsReturned.toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-1.5 tabular-nums text-[var(--text-muted)]">
                        {totalReturned > 0 ? `${((c.unitsReturned / totalReturned) * 100).toFixed(1)}%` : "—"}
                      </td>
                      {showFinancials && (
                        <td className="px-4 py-1.5 tabular-nums text-[var(--text-secondary)]">{formatBRL(c.value)}</td>
                      )}
                    </tr>
                  ))}
              </Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={showFinancials ? 4 : 3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                Sem devoluções no período/filtro selecionado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
