"use client";

import { Fragment, useState } from "react";

type Row = { key: string; unitsSold: number; revenue: number };
type ProdutoRow = { grupo: string; key: string; unitsSold: number; revenue: number };
type TamanhoRow = { grupo: string; produto: string; key: string; unitsSold: number; revenue: number };

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const SIZE_ORDER: Record<string, number> = { P: 1, M: 2, G: 3, GG: 4, XG: 5, XGG: 6, "2XG": 7, "3XG": 8 };

function compareTamanho(a: string, b: string): number {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  const oa = SIZE_ORDER[a] ?? 99;
  const ob = SIZE_ORDER[b] ?? 99;
  if (oa !== ob) return oa - ob;
  return a.localeCompare(b, "pt-BR");
}

export function ExpandableSalesTable({
  rows,
  produtoRows,
  tamanhoRows,
  totalUnits,
  showFinancials,
  emptyMessage = "Sem vendas no período/filtro selecionado.",
  parentLabel = "Grupo",
  subLabel,
}: {
  rows: Row[];
  produtoRows: ProdutoRow[];
  tamanhoRows?: TamanhoRow[];
  totalUnits: number;
  showFinancials: boolean;
  emptyMessage?: string;
  parentLabel?: string;
  subLabel?: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [openSub, setOpenSub] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSub(compositeKey: string) {
    setOpenSub((prev) => {
      const next = new Set(prev);
      if (next.has(compositeKey)) next.delete(compositeKey);
      else next.add(compositeKey);
      return next;
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">{parentLabel}</th>
            <th className="px-4 py-2 font-medium">Unidades brutas</th>
            <th className="px-4 py-2 font-medium">% do total</th>
            {showFinancials && <th className="px-4 py-2 font-medium">Receita bruta</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.has(r.key);
            const produtos = produtoRows.filter((p) => p.grupo === r.key);
            return (
              <Fragment key={r.key}>
                {/* Level 1 — grupo / tamanho / produto */}
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

                {/* Level 2 — produto (sub-row) */}
                {isOpen &&
                  produtos.map((p) => {
                    const subKey = `${r.key}\x00${p.key}`;
                    const isSubOpen = openSub.has(subKey);
                    const tamanhos = (tamanhoRows?.filter((t) => t.grupo === r.key && t.produto === p.key) ?? [])
                      .slice()
                      .sort((a, b) => compareTamanho(a.key, b.key));
                    return (
                      <Fragment key={`${r.key}::${p.key}`}>
                        <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] last:border-0 hover:bg-[var(--surface-1)]">
                          <td className="py-1.5 pr-4 pl-10 text-[var(--text-secondary)]">
                            <button
                              type="button"
                              onClick={() => toggleSub(subKey)}
                              className="flex items-center gap-2 text-left"
                              disabled={tamanhos.length === 0}
                            >
                              <span
                                className="inline-block w-3 text-[var(--text-muted)] transition-transform"
                                style={{ transform: isSubOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                              >
                                {tamanhos.length > 0 ? "▸" : ""}
                              </span>
                              {p.key}
                            </button>
                          </td>
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

                        {/* Level 3 — tamanho */}
                        {isSubOpen &&
                          tamanhos.map((t) => (
                            <tr key={`${r.key}::${p.key}::${t.key}`} className="border-b border-[var(--gridline)] bg-[var(--surface-1)] last:border-0">
                              <td className="py-1 pr-4 pl-16 text-xs text-[var(--text-muted)]">{t.key}</td>
                              <td className="px-4 py-1 tabular-nums text-xs text-[var(--text-muted)]">
                                {t.unitsSold.toLocaleString("pt-BR")}
                              </td>
                              <td className="px-4 py-1 tabular-nums text-xs text-[var(--text-muted)]">
                                {totalUnits > 0 ? `${((t.unitsSold / totalUnits) * 100).toFixed(1)}%` : "—"}
                              </td>
                              {showFinancials && (
                                <td className="px-4 py-1 tabular-nums text-xs text-[var(--text-muted)]">{formatBRL(t.revenue)}</td>
                              )}
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
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
