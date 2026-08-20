"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

type Month = { month: string; novos: number; recorrentes: number };

function formatMonth(m: string) {
  const [year, mon] = m.split("-");
  const date = new Date(Number(year), Number(mon) - 1);
  return date.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
}

export function ClienteRetencaoChart({ data }: { data: Month[] }) {
  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey="month"
          tickFormatter={formatMonth}
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(value, name) => [value, name === "novos" ? "Novos" : "Recorrentes"]}
          labelFormatter={(label) => (typeof label === "string" ? formatMonth(label) : String(label))}
        />
        <Legend
          formatter={(value) => (value === "novos" ? "Novos" : "Recorrentes")}
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
        />
        <Bar dataKey="recorrentes" stackId="a" fill="#2a78d6" radius={[0, 0, 0, 0]} maxBarSize={32} />
        <Bar dataKey="novos" stackId="a" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  );
}
