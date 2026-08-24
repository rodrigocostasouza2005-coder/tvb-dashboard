"use client";

import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";

type Row = { name: string; revenue: number };

function truncate(label: string, max = 14) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export function ParetoChart({ rows, maxItems = 30 }: { rows: Row[]; maxItems?: number }) {
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  if (total === 0 || rows.length === 0) return null;

  const capped = rows.slice(0, maxItems);
  let cumulative = 0;
  const data = capped.map((r) => {
    cumulative += r.revenue;
    return {
      label: truncate(r.name),
      fullLabel: r.name,
      individual: (r.revenue / total) * 100,
      acumulado: (cumulative / total) * 100,
    };
  });

  const height = 320;

  return (
    <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)]">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "var(--series-1)" }} />
            % da receita bruta (individual)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--series-2)" }} />
            % acumulado
          </span>
        </div>
        {rows.length > maxItems && (
          <span className="text-xs text-[var(--text-muted)]">Top {maxItems} de {rows.length}</span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 48 }}>
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--text-muted)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval={0}
            angle={-40}
            textAnchor="end"
            height={60}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <ReferenceLine y={80} stroke="var(--text-muted)" strokeDasharray="4 4" label={{ value: "80%", position: "right", fill: "var(--text-muted)", fontSize: 10 }} />
          <ReferenceLine y={95} stroke="var(--text-muted)" strokeDasharray="4 4" label={{ value: "95%", position: "right", fill: "var(--text-muted)", fontSize: 10 }} />
          <Tooltip
            contentStyle={{
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
            formatter={(value, name) => [
              `${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`,
              name === "individual" ? "% da receita bruta" : "% acumulado",
            ]}
          />
          <Bar dataKey="individual" fill="var(--series-1)" radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Line dataKey="acumulado" stroke="var(--series-2)" strokeWidth={2} dot={{ r: 3, fill: "var(--series-2)" }} activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
