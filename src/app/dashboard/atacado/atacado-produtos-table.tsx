"use client";

import { Fragment, useState } from "react";

type ProdutoRow = {
  grupo: string;
  produto: string;
  unidades: number;
  receita: number;
};

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function AtacadoProdutosTable({ rows }: { rows: ProdutoRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  function toggle(grupo: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(grupo)) next.delete(grupo);
      else next.add(grupo);
      return next;
    });
  }

  // Agrupa por grupo, somando unidades e receita
  const gruposMap = new Map<string, { unidades: number; receita: number }>();
  for (const r of rows) {
    const cur = gruposMap.get(r.grupo) ?? { unidades: 0, receita: 0 };
    cur.unidades += r.unidades;
    cur.receita += r.receita;
    gruposMap.set(r.grupo, cur);
  }

  // Ordena grupos por receita desc
  const grupoList = [...gruposMap.entries()].sort(([, a], [, b]) => b.receita - a.receita);

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Grupo / Produto</th>
            <th className="px-4 py-2 font-medium text-right">Unidades brutas</th>
            <th className="px-4 py-2 font-medium text-right">Receita bruta</th>
          </tr>
        </thead>
        <tbody>
          {grupoList.map(([grupo, g]) => {
            const isOpen = open.has(grupo);
            const produtos = rows.filter((r) => r.grupo === grupo).sort((a, b) => b.receita - a.receita);
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
                  <td className="px-4 py-2 tabular-nums text-right text-[var(--text-primary)]">
                    {g.unidades.toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-right font-medium text-[var(--text-primary)]">
                    {formatBRL(g.receita)}
                  </td>
                </tr>
                {isOpen &&
                  produtos.map((p) => (
                    <tr
                      key={p.produto}
                      className="border-b border-[var(--gridline)] bg-[var(--page-plane)] last:border-0"
                    >
                      <td className="py-1.5 pr-4 pl-10 text-[var(--text-secondary)]">{p.produto}</td>
                      <td className="px-4 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">
                        {p.unidades.toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">
                        {formatBRL(p.receita)}
                      </td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                Nenhum dado encontrado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
