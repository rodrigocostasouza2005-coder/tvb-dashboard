"use client";

import { Fragment, useState } from "react";

export type TopProdutoRow = {
  key: string; // produto
  grupo: string;
  unitsSold: number;
  revenue: number;
  estoque: number;
  tamanhos: { tamanho: string; estoque: number; vendido: number }[];
};

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Tabela do Top 10 (mais/menos vendidos) com um dropdown por produto — pedido do Rodrigo em
// 2026-09-28: ver estoque disponível e vendido por tamanho, sem sair da página. Compartilhada
// entre top-mais-vendidos e top-menos-vendidos (mesmo formato de linha nas duas).
export function TopProdutosTable({
  rows,
  showFinancials,
  emptyMessage = "Sem vendas no período selecionado.",
}: {
  rows: TopProdutoRow[];
  showFinancials: boolean;
  emptyMessage?: string;
}) {
  const [aberto, setAberto] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setAberto((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">Grupo</th>
            <th className="px-4 py-2 font-medium">Produto</th>
            <th className="px-4 py-2 font-medium text-right">Unidades líquidas</th>
            <th className="px-4 py-2 font-medium text-right">Estoque atual</th>
            {showFinancials && <th className="px-4 py-2 font-medium text-right">Receita líquida</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isOpen = aberto.has(r.key);
            const temTamanhos = r.tamanhos.length > 0;
            return (
              <Fragment key={r.key}>
                <tr className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 tabular-nums text-[var(--text-muted)]">{i + 1}</td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{r.grupo}</td>
                  <td className="px-4 py-2 font-medium text-[var(--text-primary)]">
                    <button
                      type="button"
                      onClick={() => toggle(r.key)}
                      className="flex items-center gap-2 text-left disabled:cursor-default"
                      disabled={!temTamanhos}
                    >
                      <span
                        className="inline-block w-3 text-[var(--text-muted)] transition-transform"
                        style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                      >
                        {temTamanhos ? "▸" : ""}
                      </span>
                      {r.key}
                    </button>
                  </td>
                  <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                    {r.unitsSold.toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                    {r.estoque.toLocaleString("pt-BR")}
                  </td>
                  {showFinancials && (
                    <td className="px-4 py-2 tabular-nums text-right text-[var(--text-primary)]">
                      {formatBRL(r.revenue)}
                    </td>
                  )}
                </tr>
                {isOpen && temTamanhos && (
                  <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] last:border-0">
                    <td colSpan={showFinancials ? 6 : 5} className="px-4 py-2 pl-10">
                      <table className="w-full max-w-md text-xs">
                        <thead>
                          <tr className="text-left text-[var(--text-muted)]">
                            <th className="py-1 pr-4 font-medium">Tamanho</th>
                            <th className="py-1 pr-4 text-right font-medium">Estoque disponível</th>
                            <th className="py-1 text-right font-medium">Vendido</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.tamanhos.map((t) => (
                            <tr key={t.tamanho} className="border-t border-[var(--gridline)]">
                              <td className="py-1 pr-4 text-[var(--text-secondary)]">{t.tamanho}</td>
                              <td className="py-1 pr-4 text-right tabular-nums text-[var(--text-secondary)]">{t.estoque.toLocaleString("pt-BR")}</td>
                              <td className="py-1 text-right tabular-nums text-[var(--text-secondary)]">{t.vendido.toLocaleString("pt-BR")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={showFinancials ? 6 : 5} className="px-4 py-6 text-center text-[var(--text-muted)]">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
