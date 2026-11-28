"use client";

import { BarChart, Bar, Cell, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { LinhaGradeTamanho } from "@/lib/metrics";

const COR_SITUACAO: Record<string, string> = {
  ruptura: "var(--status-critical)",
  ajustar: "var(--status-warning)",
  equilibrio: "var(--status-good)",
  excesso: "var(--status-serious)",
};

// Distribuição da Grade (seção 5.3 do briefing) — barra de estoque atual colorida por situação +
// linha tracejada de estoque ideal sobreposta, mesma convenção visual de atacado-grupos-chart.tsx
// (cores via var(--...), tick 11px, sem borda arredondada em excesso).
export function GradeChart({ linhas }: { linhas: LinhaGradeTamanho[] }) {
  if (linhas.length === 0) return <p className="text-xs text-[var(--text-muted)]">Sem dado suficiente para este recorte.</p>;

  const data = linhas.map((l) => ({ tamanho: l.tamanho, estoqueAtual: l.estoqueAtual, estoqueIdeal: l.estoqueIdeal, situacao: l.situacao }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" vertical={false} />
        <XAxis dataKey="tamanho" tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
        <Tooltip contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-secondary)" }} />
        <Bar dataKey="estoqueAtual" name="Estoque Atual" radius={[2, 2, 0, 0]} maxBarSize={32}>
          {data.map((d, i) => (
            <Cell key={i} fill={COR_SITUACAO[d.situacao] ?? "var(--series-1)"} />
          ))}
        </Bar>
        <Line type="monotone" dataKey="estoqueIdeal" name="Estoque Ideal" stroke="var(--text-secondary)" strokeDasharray="5 3" strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
