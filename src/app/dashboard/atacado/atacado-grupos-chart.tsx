"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

type Row = { grupo: string; unidades: number; receita: number };

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function AtacadoGruposChart({ rows }: { rows: Row[] }) {
  // Agrega por grupo e pega top 12
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.grupo, (map.get(r.grupo) ?? 0) + r.receita);
  const data = [...map.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 12)
    .map(([grupo, receita]) => ({ grupo, receita }));

  if (data.length === 0) return null;

  const height = Math.max(240, data.length * 36);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 80, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v) => `R$${(Number(v) / 1000).toFixed(0)}k`}
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="grupo"
          width={130}
          tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(value) => [formatBRL(Number(value)), "Receita bruta"]}
        />
        <Bar dataKey="receita" fill="#2a78d6" radius={[0, 4, 4, 0]} maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}
