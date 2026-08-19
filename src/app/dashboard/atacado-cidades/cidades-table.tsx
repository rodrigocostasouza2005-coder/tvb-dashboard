"use client";

import { useMemo, useState } from "react";

type CidadeRow = {
  cidade: string;
  estado: string;
  pedidos: number;
  unidades: number;
  receita: number;
};

type SortCol = "cidade" | "estado" | "pedidos" | "unidades" | "receita";
type SortDir = "asc" | "desc";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const selectClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs text-[var(--text-primary)]";

export function CidadesTable({ rows }: { rows: CidadeRow[] }) {
  const [sortCol, setSortCol] = useState<SortCol>("receita");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [estadoFiltro, setEstadoFiltro] = useState("");
  const [cidadeFiltro, setCidadeFiltro] = useState("");

  const estados = useMemo(() => [...new Set(rows.map((r) => r.estado))].sort(), [rows]);

  const cidadesDoEstado = useMemo(
    () =>
      [...new Set(rows.filter((r) => estadoFiltro === "" || r.estado === estadoFiltro).map((r) => r.cidade))].sort(),
    [rows, estadoFiltro]
  );

  function handleSort(col: SortCol) {
    if (col === sortCol) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  }

  function sortIndicator(col: SortCol) {
    if (col !== sortCol) return null;
    return <span className="ml-1 text-xs">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (estadoFiltro === "" || r.estado === estadoFiltro) &&
          (cidadeFiltro === "" || r.cidade === cidadeFiltro)
      ),
    [rows, estadoFiltro, cidadeFiltro]
  );

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (typeof av === "string" && typeof bv === "string") return dir * av.localeCompare(bv, "pt-BR");
      return dir * ((av as number) - (bv as number));
    });
  }, [filtered, sortCol, sortDir]);

  const thClass = "px-4 py-2 font-medium cursor-pointer select-none hover:text-[var(--text-primary)]";

  return (
    <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full min-w-[600px] text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className={thClass} onClick={() => handleSort("estado")}>
              Estado{sortIndicator("estado")}
            </th>
            <th className={thClass} onClick={() => handleSort("cidade")}>
              Cidade{sortIndicator("cidade")}
            </th>
            <th className={`${thClass} text-right`} onClick={() => handleSort("pedidos")}>
              Pedidos{sortIndicator("pedidos")}
            </th>
            <th className={`${thClass} text-right`} onClick={() => handleSort("unidades")}>
              Unidades{sortIndicator("unidades")}
            </th>
            <th className={`${thClass} text-right`} onClick={() => handleSort("receita")}>
              Receita{sortIndicator("receita")}
            </th>
          </tr>
          <tr className="border-b border-[var(--gridline)] bg-[var(--surface-1)]">
            <th className="px-4 py-1.5">
              <select
                className={selectClass}
                value={estadoFiltro}
                onChange={(e) => { setEstadoFiltro(e.target.value); setCidadeFiltro(""); }}
              >
                <option value="">Todos os estados</option>
                {estados.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </th>
            <th className="px-4 py-1.5">
              <select
                className={selectClass}
                value={cidadeFiltro}
                onChange={(e) => setCidadeFiltro(e.target.value)}
              >
                <option value="">Todas as cidades</option>
                {cidadesDoEstado.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </th>
            <th className="px-4 py-1.5" colSpan={3}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr
              key={i}
              className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]"
            >
              <td className="px-4 py-2 text-[var(--text-secondary)]">{r.estado}</td>
              <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{r.cidade}</td>
              <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                {r.pedidos.toLocaleString("pt-BR")}
              </td>
              <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                {r.unidades.toLocaleString("pt-BR")}
              </td>
              <td className="px-4 py-2 tabular-nums text-right font-medium text-[var(--text-primary)]">
                {formatBRL(r.receita)}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-[var(--text-muted)]">
                Nenhuma cidade encontrada.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
