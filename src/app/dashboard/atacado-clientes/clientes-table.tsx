"use client";

import { useMemo, useState } from "react";

type ClienteRow = {
  clienteNome: string;
  cidade: string;
  estado: string;
  pedidos: number;
  unidades: number;
  receita: number;
  ultimaCompra: Date | null;
  primeiraCompra: Date | null;
  isNovo: boolean;
};

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(date: Date | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("pt-BR");
}

const selectClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs text-[var(--text-primary)]";

const LIMIT = 150;

export function ClientesTable({ rows }: { rows: ClienteRow[] }) {
  const [search, setSearch] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState("");

  const estados = useMemo(() => [...new Set(rows.map((r) => r.estado))].sort(), [rows]);

  // Sort by receita desc by default (rows already sorted from server, but filter may reorder)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (estadoFiltro === "" || r.estado === estadoFiltro) &&
        (q === "" || r.clienteNome.toLowerCase().includes(q))
    );
  }, [rows, search, estadoFiltro]);

  const visible = filtered.slice(0, LIMIT);

  return (
    <div>
      {/* Search input */}
      <div className="mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente..."
          className="w-full max-w-xs rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
      </div>

      <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full min-w-[800px] text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Cidade</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2 font-medium text-right">Pedidos</th>
              <th className="px-4 py-2 font-medium text-right">Unidades brutas</th>
              <th className="px-4 py-2 font-medium text-right">Receita bruta</th>
              <th className="px-4 py-2 font-medium">Última compra</th>
              <th className="px-4 py-2 font-medium">Novo?</th>
            </tr>
            <tr className="border-b border-[var(--gridline)] bg-[var(--surface-1)]">
              <th className="px-4 py-1.5" colSpan={2}></th>
              <th className="px-4 py-1.5">
                <select
                  className={selectClass}
                  value={estadoFiltro}
                  onChange={(e) => setEstadoFiltro(e.target.value)}
                >
                  <option value="">Todos</option>
                  {estados.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </th>
              <th className="px-4 py-1.5" colSpan={5}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr
                key={i}
                className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]"
              >
                <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{r.clienteNome}</td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{r.cidade}</td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{r.estado}</td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                  {r.pedidos.toLocaleString("pt-BR")}
                </td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                  {r.unidades.toLocaleString("pt-BR")}
                </td>
                <td className="px-4 py-2 tabular-nums text-right font-medium text-[var(--text-primary)]">
                  {formatBRL(r.receita)}
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{formatDate(r.ultimaCompra)}</td>
                <td className="px-4 py-2">
                  {r.isNovo ? (
                    <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900 dark:text-green-300">
                      Novo
                    </span>
                  ) : (
                    <span className="text-[var(--text-muted)]">—</span>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Nenhum cliente encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Mostrando {visible.length} de {filtered.length} clientes
      </p>
    </div>
  );
}
