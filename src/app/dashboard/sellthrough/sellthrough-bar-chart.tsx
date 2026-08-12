"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ReferenceLine, ResponsiveContainer } from "recharts";
import { statusFor } from "../status-filter";

function truncate(label: string, max = 18) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export function SellthroughBarChart({ data }: { data: { key: string; sellThroughRate: number | null }[] }) {
  const rows = data
    .filter((d) => d.sellThroughRate !== null)
    .slice(0, 12)
    .map((d) => ({ label: truncate(d.key), key: d.key, rate: d.sellThroughRate as number }));

  if (rows.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--text-muted)]">
        Sem dados suficientes pra calcular sell-through no período/filtro selecionado.
      </div>
    );
  }

  const height = Math.max(rows.length * 34, 120);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
        <XAxis type="number" domain={[0, 100]} hide />
        <YAxis
          type="category"
          dataKey="label"
          width={140}
          tick={{ fill: "var(--text-primary)", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <ReferenceLine x={30} stroke="var(--status-warning)" strokeDasharray="3 3" ifOverflow="extendDomain" />
        <ReferenceLine x={50} stroke="var(--status-good)" strokeDasharray="3 3" ifOverflow="extendDomain" />
        <Tooltip
          cursor={{ fill: "var(--gridline)", opacity: 0.4 }}
          contentStyle={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.key ?? ""}
          formatter={(value) => [`${Number(value ?? 0).toFixed(1)}%`, "Sell-through"]}
        />
        <Bar dataKey="rate" radius={[0, 4, 4, 0]} maxBarSize={20}>
          {rows.map((r) => (
            <Cell key={r.key} fill={statusFor(r.rate).color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
