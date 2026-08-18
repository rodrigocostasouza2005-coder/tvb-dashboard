"use client";

import { useState } from "react";
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
  const [showAll, setShowAll] = useState(false);

  const sorted = rows
    .filter((r) => r.sellThroughRate != null)
    .sort((a, b) => (b.sellThroughRate ?? 0) - (a.sellThroughRate ?? 0));

  if (sorted.length === 0) return null;

  const visible = showAll ? sorted : sorted.slice(0, 20);
  const data = visible.map((r) => ({ name: r.produto, value: r.sellThroughRate ?? 0 }));
  const barWidth = Math.max(32, Math.min(60, 900 / data.length));

  return (
    <div>
      {sorted.length > 20 && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="rounded-md border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
          >
            {showAll ? `Mostrar top 20` : `Ver todos (${sorted.length})`}
          </button>
        </div>
      )}
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 80 }} barSize={barWidth}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10, fill: "var(--text-secondary)" }}
          angle={-45}
          textAnchor="end"
          interval={0}
        />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11, fill: "var(--text-muted)" }}
          axisLine={false}
          tickLine={false}
          width={36}
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
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={barColor(entry.value)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
}
