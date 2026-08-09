"use client";

import { useMemo, useState } from "react";

type Row = {
  key: string;
  sellThroughRate: number | null;
  inventoryTurnover: number | null;
  status: { label: string; color: string; key: string | null };
};

const selectClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs text-[var(--text-primary)]";

// Filtro em cascata de coluna (dropdown no cabeçalho) — escolher "" (Todos) mostra tudo,
// mesmo padrão da tabela de regras do Estoque Mínimo.
export function SellthroughTable({ rows, dimensionLabel }: { rows: Row[]; dimensionLabel: string }) {
  const [key, setKey] = useState("");
  const [statusKey, setStatusKey] = useState("");

  const keys = useMemo(() => [...new Set(rows.map((r) => r.key))].sort(), [rows]);
  const statusOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (r.status.key) seen.set(r.status.key, r.status.label);
    return [...seen.entries()];
  }, [rows]);

  const filtered = rows.filter(
    (r) => (key === "" || r.key === key) && (statusKey === "" || r.status.key === statusKey)
  );
  const sorted = [...filtered].sort((a, b) => (b.sellThroughRate ?? -1) - (a.sellThroughRate ?? -1));

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">{dimensionLabel}</th>
            <th className="px-4 py-2 font-medium">Sell-through</th>
            <th className="px-4 py-2 font-medium">Giro</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
          <tr className="border-b border-[var(--gridline)] bg-[var(--surface-1)]">
            <th className="px-4 py-1.5">
              <select className={selectClass} value={key} onChange={(e) => setKey(e.target.value)}>
                <option value="">Todos</option>
                {keys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </th>
            <th className="px-4 py-1.5"></th>
            <th className="px-4 py-1.5"></th>
            <th className="px-4 py-1.5">
              <select className={selectClass} value={statusKey} onChange={(e) => setStatusKey(e.target.value)}>
                <option value="">Todos</option>
                {statusOptions.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.key} className="border-b border-[var(--gridline)] last:border-0">
              <td className="px-4 py-2 font-medium">{r.key}</td>
              <td className="px-4 py-2 tabular-nums">
                {r.sellThroughRate !== null ? `${r.sellThroughRate.toFixed(0)}%` : "—"}
              </td>
              <td className="px-4 py-2 tabular-nums">
                {r.inventoryTurnover !== null ? r.inventoryTurnover.toFixed(2) : "—"}
              </td>
              <td className="px-4 py-2">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.status.color }} />
                  {r.status.label}
                </span>
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-[var(--text-muted)]">
                Sem dados para o período/filtro selecionado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
