"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, LabelList, ResponsiveContainer } from "recharts";

type Row = { label: string; a: number; b: number };

function truncate(label: string, max = 18) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export function BarCompare({
  rows,
  labelA,
  labelB,
}: {
  rows: Row[];
  labelA: string;
  labelB: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <p className="text-sm text-[var(--text-muted)]">Sem dados para o período/filtro selecionado.</p>
      </div>
    );
  }

  const data = rows.map((r) => ({ ...r, label: truncate(r.label) }));
  const height = Math.max(data.length * 40, 160);
  const labelStyle = { fill: "var(--text-secondary)", fontSize: 11 };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
      <div className="mb-3 flex items-center gap-4 text-xs text-[var(--text-secondary)]">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--series-1)" }} />
          {labelA}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--series-2)" }} />
          {labelB}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" barGap={4} margin={{ top: 4, right: 36, left: 0, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={140}
            tick={{ fill: "var(--text-primary)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "var(--gridline)", opacity: 0.4 }}
            contentStyle={{
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ""}
            formatter={(value) => Number(value ?? 0).toLocaleString("pt-BR")}
          />
          <Bar dataKey="a" name={labelA} fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={14}>
            <LabelList dataKey="a" position="right" style={labelStyle} formatter={(v) => Number(v ?? 0).toLocaleString("pt-BR")} />
          </Bar>
          <Bar dataKey="b" name={labelB} fill="var(--series-2)" radius={[0, 4, 4, 0]} maxBarSize={14}>
            <LabelList dataKey="b" position="right" style={labelStyle} formatter={(v) => Number(v ?? 0).toLocaleString("pt-BR")} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
