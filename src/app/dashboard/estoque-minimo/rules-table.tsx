"use client";

import { useMemo, useState } from "react";
import { deleteMinimumRuleAction } from "./actions";

type Row = {
  id: string;
  storeName: string;
  grupo: string;
  tamanho: string;
  colecao: string | null;
  valorMinimo: number;
};

const selectClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs text-[var(--text-primary)]";

export function RulesTable({ rows }: { rows: Row[] }) {
  const [loja, setLoja] = useState("");
  const [grupo, setGrupo] = useState("");
  const [tamanho, setTamanho] = useState("");
  const [colecao, setColecao] = useState("");

  const lojas = useMemo(() => [...new Set(rows.map((r) => r.storeName))].sort(), [rows]);
  const grupos = useMemo(() => [...new Set(rows.map((r) => r.grupo))].sort(), [rows]);
  const tamanhos = useMemo(() => [...new Set(rows.map((r) => r.tamanho))].sort(), [rows]);
  const colecoes = useMemo(
    () => [...new Set(rows.map((r) => r.colecao ?? "todas"))].sort(),
    [rows]
  );

  const filtered = rows.filter(
    (r) =>
      (loja === "" || r.storeName === loja) &&
      (grupo === "" || r.grupo === grupo) &&
      (tamanho === "" || r.tamanho === tamanho) &&
      (colecao === "" || (r.colecao ?? "todas") === colecao)
  );

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Loja</th>
            <th className="px-4 py-2 font-medium">Grupo</th>
            <th className="px-4 py-2 font-medium">Tamanho</th>
            <th className="px-4 py-2 font-medium">Coleção</th>
            <th className="px-4 py-2 font-medium">Mínimo</th>
            <th className="px-4 py-2 font-medium"></th>
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
              <select className={selectClass} value={grupo} onChange={(e) => setGrupo(e.target.value)}>
                <option value="">Todos</option>
                {grupos.map((g) => (
                  <option key={g} value={g}>
                    {g}
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
            <th className="px-4 py-1.5">
              <select className={selectClass} value={colecao} onChange={(e) => setColecao(e.target.value)}>
                <option value="">Todas</option>
                {colecoes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </th>
            <th className="px-4 py-1.5"></th>
            <th className="px-4 py-1.5"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.id} className="border-b border-[var(--gridline)] last:border-0">
              <td className="px-4 py-2">{r.storeName}</td>
              <td className="px-4 py-2 font-medium">{r.grupo}</td>
              <td className="px-4 py-2">{r.tamanho}</td>
              <td className="px-4 py-2 text-[var(--text-secondary)]">{r.colecao ?? "todas"}</td>
              <td className="px-4 py-2 tabular-nums">{r.valorMinimo}</td>
              <td className="px-4 py-2">
                <form action={deleteMinimumRuleAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    type="submit"
                    className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                    style={{ color: "var(--status-critical)" }}
                  >
                    Excluir
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-[var(--text-muted)]">
                Nenhuma regra manual ainda — a Reposição usa o mínimo que vem do DAPIC.
              </td>
            </tr>
          )}
          {rows.length > 0 && filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-[var(--text-muted)]">
                Nenhuma regra bate com esse filtro.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
