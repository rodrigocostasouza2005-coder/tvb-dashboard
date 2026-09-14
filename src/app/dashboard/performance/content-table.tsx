"use client";

import { useMemo, useState } from "react";
import { deleteContentAction } from "./actions";

const TIPO_LABEL: Record<string, string> = { STORY: "Story", POST: "Post", REPOST: "Repost" };

type Row = {
  id: string;
  perfil: string;
  tipo: "STORY" | "POST" | "REPOST";
  classificacao: "QUALIFICADO" | "BASICO";
  data: string;
  engajamento: number | null;
  observacoes: string | null;
  storeName: string | null;
};

const selectClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs text-[var(--text-primary)]";

export function ContentTable({ rows, canEdit }: { rows: Row[]; canEdit: boolean }) {
  const [perfil, setPerfil] = useState("");
  const [tipo, setTipo] = useState("");
  const [classificacao, setClassificacao] = useState("");
  const [loja, setLoja] = useState("");

  const perfis = useMemo(() => [...new Set(rows.map((r) => r.perfil))].sort(), [rows]);
  const lojas = useMemo(() => [...new Set(rows.map((r) => r.storeName ?? "Sem loja"))].sort(), [rows]);

  const filtered = rows.filter(
    (r) =>
      (perfil === "" || r.perfil === perfil) &&
      (tipo === "" || r.tipo === tipo) &&
      (classificacao === "" || r.classificacao === classificacao) &&
      (loja === "" || (r.storeName ?? "Sem loja") === loja)
  );

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Perfil</th>
            <th className="px-4 py-2 font-medium">Tipo</th>
            <th className="px-4 py-2 font-medium">Loja</th>
            <th className="px-4 py-2 font-medium">Classificação</th>
            <th className="px-4 py-2 font-medium">Data</th>
            <th className="px-4 py-2 font-medium">Engajamento</th>
            <th className="px-4 py-2 font-medium">Observações</th>
            {canEdit && <th className="px-4 py-2 font-medium"></th>}
          </tr>
          <tr className="border-b border-[var(--gridline)] bg-[var(--surface-1)]">
            <th className="px-4 py-1.5">
              <select className={selectClass} value={perfil} onChange={(e) => setPerfil(e.target.value)}>
                <option value="">Todos</option>
                {perfis.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </th>
            <th className="px-4 py-1.5">
              <select className={selectClass} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="">Todos</option>
                <option value="STORY">Story</option>
                <option value="POST">Post</option>
                <option value="REPOST">Repost</option>
              </select>
            </th>
            <th className="px-4 py-1.5">
              <select className={selectClass} value={loja} onChange={(e) => setLoja(e.target.value)}>
                <option value="">Todas</option>
                {lojas.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </th>
            <th className="px-4 py-1.5">
              <select className={selectClass} value={classificacao} onChange={(e) => setClassificacao(e.target.value)}>
                <option value="">Todas</option>
                <option value="QUALIFICADO">Qualificado</option>
                <option value="BASICO">Básico</option>
              </select>
            </th>
            <th className="px-4 py-1.5" colSpan={canEdit ? 4 : 3}></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.id} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
              <td className="px-4 py-2 font-medium">{r.perfil}</td>
              <td className="px-4 py-2">{TIPO_LABEL[r.tipo]}</td>
              <td className="px-4 py-2 text-[var(--text-secondary)]">{r.storeName ?? "—"}</td>
              <td className="px-4 py-2">
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor:
                      r.classificacao === "QUALIFICADO"
                        ? "color-mix(in srgb, var(--status-good) 15%, transparent)"
                        : "color-mix(in srgb, var(--text-muted) 15%, transparent)",
                    color: r.classificacao === "QUALIFICADO" ? "var(--status-good)" : "var(--text-secondary)",
                  }}
                >
                  {r.classificacao === "QUALIFICADO" ? "Qualificado" : "Básico"}
                </span>
              </td>
              <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
                {new Date(r.data).toLocaleDateString("pt-BR", { timeZone: "UTC" })}
              </td>
              <td className="px-4 py-2 tabular-nums">{r.engajamento?.toLocaleString("pt-BR") ?? "—"}</td>
              <td className="px-4 py-2 text-[var(--text-secondary)]">{r.observacoes ?? "—"}</td>
              {canEdit && (
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <a href={`/dashboard/performance?edit=${r.id}`} className="text-xs text-[var(--series-1)] hover:underline">
                      Editar
                    </a>
                    <form action={deleteContentAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="text-xs" style={{ color: "var(--status-critical)" }}>
                        Excluir
                      </button>
                    </form>
                  </div>
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={canEdit ? 8 : 7} className="px-4 py-6 text-center text-[var(--text-muted)]">
                Nenhum conteúdo lançado no período/filtro selecionado.
              </td>
            </tr>
          )}
          {rows.length > 0 && filtered.length === 0 && (
            <tr>
              <td colSpan={canEdit ? 8 : 7} className="px-4 py-6 text-center text-[var(--text-muted)]">
                Nenhum conteúdo bate com esse filtro.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
