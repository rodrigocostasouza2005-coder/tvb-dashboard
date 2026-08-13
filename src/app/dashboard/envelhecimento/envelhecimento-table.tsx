"use client";

import { useMemo, useState } from "react";

type Row = {
  storeName: string;
  produto: string;
  tamanho: string | null;
  quantidadeDisponivel: number;
  primeiraVenda: Date | null;
  ultimaVenda: Date | null;
  diasDesdePrimeiraVenda: number;
  sellThroughRate: number | null;
  status: { label: string; color: string };
};

const selectClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs text-[var(--text-primary)]";

function formatDate(d: Date | null) {
  return d ? new Date(d).toLocaleDateString("pt-BR") : "—";
}

// Filtro por coluna no cabeçalho (Loja, Produto, Tamanho, Status) — escolher "" mostra tudo.
// Mesmo padrão usado nas tabelas de Estoque Mínimo e Sellthrough.
export function EnvelhecimentoTable({ rows }: { rows: Row[] }) {
  const [loja, setLoja] = useState("");
  const [produto, setProduto] = useState("");
  const [tamanho, setTamanho] = useState("");
  const [status, setStatus] = useState("");

  const lojas = useMemo(() => [...new Set(rows.map((r) => r.storeName))].sort(), [rows]);
  const produtos = useMemo(() => [...new Set(rows.map((r) => r.produto))].sort(), [rows]);
  const tamanhos = useMemo(
    () => [...new Set(rows.map((r) => r.tamanho ?? "—"))].sort(),
    [rows]
  );
  const statusOptions = useMemo(() => [...new Set(rows.map((r) => r.status.label))].sort(), [rows]);

  const filtered = rows.filter(
    (r) =>
      (loja === "" || r.storeName === loja) &&
      (produto === "" || r.produto === produto) &&
      (tamanho === "" || (r.tamanho ?? "—") === tamanho) &&
      (status === "" || r.status.label === status)
  );
  const visible = filtered.slice(0, 150);

  return (
    <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Loja</th>
            <th className="px-4 py-2 font-medium">Produto</th>
            <th className="px-4 py-2 font-medium">Tamanho</th>
            <th className="px-4 py-2 font-medium">Estoque</th>
            <th className="px-4 py-2 font-medium">1ª venda</th>
            <th className="px-4 py-2 font-medium">Dias desde 1ª venda</th>
            <th className="px-4 py-2 font-medium">Última venda</th>
            <th className="px-4 py-2 font-medium">Sell-through</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
          <tr className="border-b border-[var(--gridline)] bg-[var(--surface-1)]">
            <th className="px-4 py-1.5">
              <select className={selectClass} value={loja} onChange={(e) => setLoja(e.target.value)}>
                <option value="">Todas</option>
                {lojas.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </th>
            <th className="px-4 py-1.5">
              <select className={selectClass} value={produto} onChange={(e) => setProduto(e.target.value)}>
                <option value="">Todos</option>
                {produtos.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </th>
            <th className="px-4 py-1.5">
              <select className={selectClass} value={tamanho} onChange={(e) => setTamanho(e.target.value)}>
                <option value="">Todos</option>
                {tamanhos.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </th>
            <th className="px-4 py-1.5" colSpan={4}></th>
            <th className="px-4 py-1.5">
              <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Todos</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => (
            <tr key={i} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
              <td className="px-4 py-2">{r.storeName}</td>
              <td className="px-4 py-2 font-medium">{r.produto}</td>
              <td className="px-4 py-2">{r.tamanho ?? "—"}</td>
              <td className="px-4 py-2 tabular-nums">{r.quantidadeDisponivel}</td>
              <td className="px-4 py-2">{formatDate(r.primeiraVenda)}</td>
              <td className="px-4 py-2 tabular-nums">{r.diasDesdePrimeiraVenda}</td>
              <td className="px-4 py-2">{formatDate(r.ultimaVenda)}</td>
              <td className="px-4 py-2 tabular-nums">
                {r.sellThroughRate !== null ? `${r.sellThroughRate.toFixed(0)}%` : "—"}
              </td>
              <td className="px-4 py-2">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.status.color }} />
                  {r.status.label}
                </span>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-6 text-center text-[var(--text-muted)]">
                Nenhum item bate com esse filtro.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
