"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

type Row = { produto: string; sellThroughRate: number | null };

function barColor(rate: number | null) {
  if (rate == null) return "var(--text-muted)";
  if (rate >= 70) return "var(--status-ok, #22c55e)";
  if (rate >= 40) return "var(--status-warning, #f59e0b)";
  return "var(--status-critical, #ef4444)";
}

export function ColecaoDetalheChart({ rows }: { rows: Row[] }) {
  const sorted = rows
    .filter((r) => r.sellThroughRate != null)
    .sort((a, b) => (b.sellThroughRate ?? 0) - (a.sellThroughRate ?? 0));

  if (sorted.length === 0) return null;

  const data = sorted.map((r) => ({ name: r.produto, value: r.sellThroughRate ?? 0 }));
  const height = Math.max(320, data.length * 28);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11, fill: "var(--text-muted)" }}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={160}
          tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
        />
        <Tooltip
          formatter={(value) => [`${Number(value).toFixed(1)}%`, "Sell-through"]}
          contentStyle={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 12,
          }}
        />
        <Bar dataKey="value" radius={[0, 3, 3, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={barColor(entry.value)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
