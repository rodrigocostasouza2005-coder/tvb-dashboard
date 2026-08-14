"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// Paleta consistente com o resto do dashboard
const COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--cat-3)",
  "var(--cat-4)",
  "var(--status-warning)",
  "var(--series-3)",
];

function formatBRL(value: number) {
  if (value >= 1_000_000) return `R$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$${(value / 1_000).toFixed(0)}k`;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatMonth(month: string) {
  const [year, m] = month.split("-");
  const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${months[parseInt(m) - 1]}/${year.slice(2)}`;
}

type MonthRow = {
  month: string;
  revenue: Record<string, number>;
  units: Record<string, number>;
};

export function MonthlyChart({
  data,
  series,
  showRevenue,
}: {
  data: MonthRow[];
  series: string[];
  showRevenue: boolean;
}) {
  const chartData = data.map((d) => ({
    month: formatMonth(d.month),
    ...Object.fromEntries(series.map((s) => [s, showRevenue ? (d.revenue[s] ?? 0) : (d.units[s] ?? 0)])),
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--text-muted)" }}
          tickFormatter={showRevenue ? (v) => formatBRL(Number(v)) : (v) => v.toLocaleString("pt-BR")}
          width={70}
        />
        <Tooltip
          formatter={(value, name) => [
            typeof value === "number"
              ? showRevenue
                ? value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                : value.toLocaleString("pt-BR")
              : String(value),
            name,
          ]}
          contentStyle={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Bar key={s} dataKey={s} stackId="a" fill={COLORS[i % COLORS.length]} radius={i === series.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
