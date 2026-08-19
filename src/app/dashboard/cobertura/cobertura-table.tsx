"use client";

import { useMemo, useState } from "react";

type Row = {
  storeName: string;
  produto: string;
  colecao: string | null;
  grupo: string;
  tamanho: string | null;
  estoque: number;
  vendas30d: number;
  avgDailySales: number;
  diasCobertura: number | null;
  status: "critico" | "atencao" | "ok" | "sem-venda";
};

const STATUS_COLOR: Record<Row["status"], string> = {
  critico: "#ef4444",
  atencao: "#f59e0b",
  ok: "#22c55e",
  "sem-venda": "var(--text-muted)",
};

const STATUS_LABEL: Record<Row["status"], string> = {
  critico: "Crítico",
  atencao: "Atenção",
  ok: "OK",
  "sem-venda": "Sem venda",
};

const selectClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs text-[var(--text-primary)]";

export function CoberturaTable({ rows }: { rows: Row[] }) {
  const [loja, setLoja] = useState("");
  const [colecoesSel, setColecoesSel] = useState<Set<string>>(new Set());
  const [statusFiltro, setStatusFiltro] = useState<Row["status"] | "">("");

  const lojas = useMemo(() => [...new Set(rows.map((r) => r.storeName))].sort(), [rows]);
  const colecoes = useMemo(
    () => [...new Set(rows.map((r) => r.colecao ?? "—"))].sort(),
    [rows]
  );

  function toggleColecao(c: string) {
    setColecoesSel((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  // Quando "agrupado": soma estoque+vendas de todas as lojas por produto+tamanho
  const baseRows = useMemo(() => {
    if (loja !== "__agrupado__") return rows;
    const map = new Map<string, Row>();
    for (const r of rows) {
      const key = `${r.produto}\x00${r.tamanho ?? ""}`;
      const cur = map.get(key);
      if (!cur) {
        map.set(key, { ...r, storeName: "Todas as lojas" });
      } else {
        const estoque = cur.estoque + r.estoque;
        const vendas30d = cur.vendas30d + r.vendas30d;
        const avgDailySales = vendas30d / 30;
        const diasCobertura = avgDailySales > 0 ? Math.round(estoque / avgDailySales) : null;
        const status: Row["status"] =
          diasCobertura === null ? "sem-venda"
          : diasCobertura < 7 ? "critico"
          : diasCobertura < 30 ? "atencao"
          : "ok";
        map.set(key, { ...cur, estoque, vendas30d, avgDailySales, diasCobertura, status });
      }
    }
    return [...map.values()].sort((a, b) => {
      const order = { critico: 0, atencao: 1, ok: 2, "sem-venda": 3 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return (a.diasCobertura ?? 9999) - (b.diasCobertura ?? 9999);
    });
  }, [rows, loja]);

  const filtered = baseRows.filter(
    (r) =>
      (loja === "" || loja === "__agrupado__" || r.storeName === loja) &&
      (statusFiltro === "" || r.status === statusFiltro) &&
      (colecoesSel.size === 0 || colecoesSel.has(r.colecao ?? "—"))
  );
  const visible = filtered.slice(0, 200);

  const statusButtons: { key: Row["status"] | ""; label: string }[] = [
    { key: "", label: "Todos" },
    { key: "critico", label: "Crítico" },
    { key: "atencao", label: "Atenção" },
    { key: "ok", label: "OK" },
    { key: "sem-venda", label: "Sem venda" },
  ];

  return (
    <div>
      {/* Filtro de coleção — chips multi-seleção */}
      <div className="mb-3 flex flex-wrap gap-2">
        {colecoes.map((c) => {
          const active = colecoesSel.has(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggleColecao(c)}
              className={`rounded-full border px-3 py-0.5 text-xs font-medium transition-colors ${
                active
                  ? "border-[var(--series-1)] bg-[var(--series-1)] text-white"
                  : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
              }`}
            >
              {c}
            </button>
          );
        })}
        {colecoesSel.size > 0 && (
          <button
            type="button"
            onClick={() => setColecoesSel(new Set())}
            className="rounded-full border border-[var(--border)] px-3 py-0.5 text-xs text-[var(--text-muted)] hover:bg-[var(--page-plane)]"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Filtro de status — pills, seleção única */}
      <div className="mb-3 flex flex-wrap gap-2">
        {statusButtons.map(({ key, label }) => {
          const active = statusFiltro === key;
          const color = key !== "" ? STATUS_COLOR[key] : undefined;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFiltro(key)}
              className={`rounded-full border px-3 py-0.5 text-xs font-medium transition-colors ${
                active
                  ? "border-[var(--series-1)] bg-[var(--series-1)] text-white"
                  : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
              }`}
              style={active && color ? { backgroundColor: color, borderColor: color } : undefined}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Loja</th>
              <th className="px-4 py-2 font-medium">Produto</th>
              <th className="px-4 py-2 font-medium">Tamanho</th>
              <th className="px-4 py-2 font-medium text-right">Estoque</th>
              <th className="px-4 py-2 font-medium text-right">Vendas 30d</th>
              <th className="px-4 py-2 font-medium text-right">Média/dia</th>
              <th className="px-4 py-2 font-medium">Dias de cobertura</th>
            </tr>
            <tr className="border-b border-[var(--gridline)] bg-[var(--surface-1)]">
              <th className="px-4 py-1.5">
                <select
                  className={selectClass}
                  value={loja}
                  onChange={(e) => setLoja(e.target.value)}
                >
                  <option value="">Todas (por loja)</option>
                  <option value="__agrupado__">Todas (agrupado)</option>
                  {lojas.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </th>
              <th className="px-4 py-1.5" colSpan={6}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const color = STATUS_COLOR[r.status];
              const barWidth =
                r.diasCobertura !== null
                  ? Math.min((r.diasCobertura / 60) * 100, 100)
                  : 20;
              return (
                <tr
                  key={i}
                  className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]"
                >
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{r.storeName}</td>
                  <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{r.produto}</td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{r.tamanho ?? "—"}</td>
                  <td className="px-4 py-2 tabular-nums text-right text-[var(--text-primary)]">
                    {r.estoque}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                    {r.vendas30d}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                    {r.avgDailySales > 0 ? r.avgDailySales.toFixed(1) : "—"}
                  </td>
                  <td className="px-4 py-2 min-w-[140px]">
                    <div
                      className="text-base font-bold tabular-nums leading-tight"
                      style={{ color }}
                    >
                      {r.diasCobertura !== null ? r.diasCobertura : "—"}
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-[var(--gridline)]">
                      <div
                        className="h-1.5 rounded-full transition-all"
                        style={{ width: `${barWidth}%`, backgroundColor: color }}
                      />
                    </div>
                    <div
                      className="mt-0.5 text-[10px] font-medium"
                      style={{ color }}
                    >
                      {STATUS_LABEL[r.status]}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-6 text-center text-[var(--text-muted)]"
                >
                  Nenhum item bate com esse filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Mostrando {visible.length} de {filtered.length} itens
      </p>
    </div>
  );
}
