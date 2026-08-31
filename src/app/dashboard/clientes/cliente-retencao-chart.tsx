"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList,
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
          formatter={(value, name, item) => {
            const total = (item?.payload?.novos ?? 0) + (item?.payload?.recorrentes ?? 0);
            const pct = total > 0 ? Math.round((Number(value) / total) * 100) : 0;
            return [`${value} (${pct}%)`, name === "novos" ? "Novos" : "Recorrentes"];
          }}
          labelFormatter={(label) => (typeof label === "string" ? formatMonth(label) : String(label))}
        />
        <Legend
          formatter={(value) => (value === "novos" ? "Novos" : "Recorrentes")}
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
        />
        <Bar dataKey="recorrentes" stackId="a" fill="#2a78d6" radius={[0, 0, 0, 0]} maxBarSize={32}>
          <LabelList
            dataKey="recorrentes"
            position="center"
            content={(props: any) => {
              const { x, y, width, height, value, index } = props;
              const m = data[index];
              const total = (m?.novos ?? 0) + (m?.recorrentes ?? 0);
              if (!total || height < 14) return null;
              const pct = Math.round((Number(value) / total) * 100);
              return (
                <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="#fff">
                  {pct}%
                </text>
              );
            }}
          />
        </Bar>
        <Bar dataKey="novos" stackId="a" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  );
}
