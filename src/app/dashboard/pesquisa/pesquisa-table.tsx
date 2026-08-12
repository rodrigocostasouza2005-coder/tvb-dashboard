"use client";

import { Fragment, useState } from "react";

type Row = {
  key: string;
  unitsSold: number;
  currentStock: number;
  sellThroughRate: number | null;
  porTamanho: Record<string, number>;
  porLoja: { loja: string; qtd: number }[];
};

function statusFor(rate: number | null): { label: string; color: string } {
  if (rate === null) return { label: "—", color: "var(--text-muted)" };
  if (rate >= 50) return { label: "Bom", color: "var(--status-good)" };
  if (rate >= 30) return { label: "Atenção", color: "var(--status-warning)" };
  return { label: "Crítico", color: "var(--status-critical)" };
}

// Clicar na seta abre, embaixo da linha do produto, quanto tem em cada loja de venda (não
// armazém tipo Defeito/Lixeira) — complementa a quebra por tamanho que já aparece nas colunas.
export function PesquisaTable({
  rows,
  tamanhos,
  emptyMessage,
}: {
  rows: Row[];
  tamanhos: string[];
  emptyMessage: string;
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
    <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Produto</th>
            <th className="px-4 py-2 font-medium">Vendido no período</th>
            {tamanhos.map((t) => (
              <th key={t} className="px-3 py-2 text-center font-medium">
                {t}
              </th>
            ))}
            <th className="px-4 py-2 font-medium">Total estoque</th>
            <th className="px-4 py-2 font-medium">Sell-through</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const status = statusFor(r.sellThroughRate);
            const pct = r.sellThroughRate ?? 0;
            const isOpen = open.has(r.key);
            const maxLoja = Math.max(1, ...r.porLoja.map((l) => l.qtd));
            return (
              <Fragment key={r.key}>
                <tr className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium">
                    <button
                      type="button"
                      onClick={() => toggle(r.key)}
                      className="flex items-center gap-2 text-left"
                      disabled={r.porLoja.length === 0}
                    >
                      <span
                        className="inline-block w-3 text-[var(--text-muted)] transition-transform"
                        style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                      >
                        {r.porLoja.length > 0 ? "▸" : ""}
                      </span>
                      {r.key}
                    </button>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{r.unitsSold.toLocaleString("pt-BR")}</td>
                  {tamanhos.map((t) => {
                    const qtd = r.porTamanho[t] ?? 0;
                    return (
                      <td key={t} className="px-3 py-2 text-center tabular-nums text-[var(--text-secondary)]">
                        {qtd > 0 ? qtd.toLocaleString("pt-BR") : "—"}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2 tabular-nums font-medium">{r.currentStock.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2">
                    {r.sellThroughRate !== null ? (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--gridline)]">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: status.color }}
                          />
                        </div>
                        <span className="tabular-nums text-[var(--text-secondary)]">{pct.toFixed(0)}%</span>
                      </div>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{ backgroundColor: `color-mix(in srgb, ${status.color} 15%, transparent)`, color: status.color }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} />
                      {status.label}
                    </span>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] last:border-0">
                    <td colSpan={4 + tamanhos.length} className="px-4 py-3 pl-10">
                      <div className="flex flex-col gap-1.5">
                        {r.porLoja.map((l) => (
                          <div key={l.loja} className="flex items-center gap-3 text-xs">
                            <span className="w-40 shrink-0 text-[var(--text-secondary)]">{l.loja}</span>
                            <div className="h-2 flex-1 max-w-xs rounded-full bg-[var(--gridline)]">
                              <div
                                className="h-2 rounded-full"
                                style={{ width: `${(l.qtd / maxLoja) * 100}%`, backgroundColor: "var(--series-1)" }}
                              />
                            </div>
                            <span className="w-12 shrink-0 text-right tabular-nums text-[var(--text-primary)]">
                              {l.qtd.toLocaleString("pt-BR")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5 + tamanhos.length} className="px-4 py-6 text-center text-[var(--text-muted)]">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
