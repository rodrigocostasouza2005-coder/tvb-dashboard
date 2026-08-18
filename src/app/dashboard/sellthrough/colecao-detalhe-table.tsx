"use client";

import { Fragment, useState } from "react";
import { statusFor } from "../status-filter";

type ProdutoRow = {
  grupo: string;
  produto: string;
  produzido: number;
  vendido: number;
  devolvido: number;
  brinde: number;
  saida: number;
  sellThroughRate: number | null;
};

const STATUS_STYLE: Record<string, string> = {
  good: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  neutral: "bg-[var(--page-plane)] text-[var(--text-muted)]",
};

function stBadge(rate: number | null) {
  const status = statusFor(rate).key ?? "neutral";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold tabular-nums ${STATUS_STYLE[status]}`}>
      {rate != null ? `${rate.toFixed(1)}%` : "—"}
    </span>
  );
}

export function ColecaoDetalheTable({ rows }: { rows: ProdutoRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  function toggle(grupo: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(grupo)) next.delete(grupo);
      else next.add(grupo);
      return next;
    });
  }

  // Agrega por grupo
  const grupos = new Map<string, { produzido: number; vendido: number; devolvido: number; brinde: number; saida: number }>();
  for (const r of rows) {
    const cur = grupos.get(r.grupo) ?? { produzido: 0, vendido: 0, devolvido: 0, brinde: 0, saida: 0 };
    cur.produzido += r.produzido;
    cur.vendido += r.vendido;
    cur.devolvido += r.devolvido;
    cur.brinde += r.brinde;
    cur.saida += r.saida;
    grupos.set(r.grupo, cur);
  }

  const grupoList = [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Grupo / Produto</th>
            <th className="px-4 py-2 font-medium">Produzido</th>
            <th className="px-4 py-2 font-medium">Vendas</th>
            <th className="px-4 py-2 font-medium">Devoluções</th>
            <th className="px-4 py-2 font-medium">Brinde</th>
            <th className="px-4 py-2 font-medium">Saída líquida</th>
            <th className="px-4 py-2 font-medium">Sell-through</th>
          </tr>
        </thead>
        <tbody>
          {grupoList.map(([grupo, g]) => {
            const isOpen = open.has(grupo);
            const produtos = rows.filter((r) => r.grupo === grupo);
            const grupoRate = g.produzido > 0 ? (g.saida / g.produzido) * 100 : null;
            return (
              <Fragment key={grupo}>
                <tr className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium">
                    <button
                      type="button"
                      onClick={() => toggle(grupo)}
                      className="flex items-center gap-2 text-left"
                    >
                      <span
                        className="inline-block w-3 text-[var(--text-muted)] transition-transform"
                        style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                      >
                        ▸
                      </span>
                      {grupo}
                    </button>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{g.produzido.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 tabular-nums">{g.vendido.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">{g.devolvido.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">{g.brinde.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 tabular-nums font-medium">{g.saida.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2">{stBadge(grupoRate)}</td>
                </tr>
                {isOpen &&
                  produtos.map((p) => (
                    <tr key={p.produto} className="border-b border-[var(--gridline)] bg-[var(--page-plane)] last:border-0">
                      <td className="py-1.5 pr-4 pl-10 text-[var(--text-secondary)]">{p.produto}</td>
                      <td className="px-4 py-1.5 tabular-nums text-[var(--text-secondary)]">{p.produzido.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-1.5 tabular-nums text-[var(--text-secondary)]">{p.vendido.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-1.5 tabular-nums text-[var(--text-muted)]">{p.devolvido.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-1.5 tabular-nums text-[var(--text-muted)]">{p.brinde.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-1.5 tabular-nums text-[var(--text-secondary)]">{p.saida.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-1.5">{stBadge(p.sellThroughRate)}</td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-[var(--text-muted)]">
                Nenhum dado encontrado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
