"use client";

import { statusFor } from "../status-filter";

type Row = {
  key: string;
  vendido: number;
  produzido: number;
  revenue: number;
  sellThroughRate: number | null;
};

const STATUS_STYLE: Record<string, string> = {
  good: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  neutral: "bg-[var(--page-plane)] text-[var(--text-muted)]",
};

export function ColecaoSellthroughTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Coleção</th>
            <th className="px-4 py-2 font-medium">Produzido</th>
            <th className="px-4 py-2 font-medium">Vendido</th>
            <th className="px-4 py-2 font-medium">Em estoque</th>
            <th className="px-4 py-2 font-medium">Sell-through</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const status = statusFor(r.sellThroughRate).key ?? "neutral";
            const emEstoque = r.produzido - r.vendido;
            return (
              <tr key={r.key} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                <td className="px-4 py-2 font-medium">{r.key}</td>
                <td className="px-4 py-2 tabular-nums">{r.produzido.toLocaleString("pt-BR")}</td>
                <td className="px-4 py-2 tabular-nums">{r.vendido.toLocaleString("pt-BR")}</td>
                <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
                  {emEstoque >= 0 ? emEstoque.toLocaleString("pt-BR") : "—"}
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold tabular-nums ${STATUS_STYLE[status]}`}>
                    {r.sellThroughRate != null ? `${r.sellThroughRate.toFixed(1)}%` : "—"}
                  </span>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-[var(--text-muted)]">
                Nenhuma coleção encontrada — verifique se as ordens de produção estão sincronizadas.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
