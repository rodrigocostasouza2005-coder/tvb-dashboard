"use client";

import { PieChart as RePieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const COLORS = [
  "var(--cat-1)",
  "var(--cat-2)",
  "var(--cat-3)",
  "var(--cat-4)",
  "var(--cat-5)",
  "var(--cat-6)",
  "var(--cat-7)",
  "var(--cat-8)",
];

export function PieChart({
  data,
}: {
  data: { label: string; value: number; percentual: number }[];
}) {
  // No máximo 8 fatias (mesmo limite da paleta categórica) — o resto vira "Outros".
  const top = data.slice(0, 7);
  const rest = data.slice(7);
  const outros = rest.reduce((sum, d) => sum + d.value, 0);
  const outrosPct = rest.reduce((sum, d) => sum + d.percentual, 0);
  const slices = outros > 0 ? [...top, { label: "Outros", value: outros, percentual: outrosPct }] : top;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div style={{ width: 220, height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RePieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius="55%"
              outerRadius="90%"
              paddingAngle={2}
              stroke="var(--surface-1)"
              strokeWidth={2}
            >
              {slices.map((s, i) => (
                <Cell key={s.label} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--surface-1)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value, _name, item) => [
                `${Number(value ?? 0).toLocaleString("pt-BR")} (${(item.payload?.percentual ?? 0).toFixed(0)}%)`,
                item.payload?.label ?? "",
              ]}
            />
          </RePieChart>
        </ResponsiveContainer>
      </div>

      <ul className="flex flex-col gap-1.5 text-sm">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="text-[var(--text-primary)]">{s.label}</span>
            <span className="tabular-nums text-[var(--text-muted)]">
              {s.value.toLocaleString("pt-BR")} ({s.percentual.toFixed(0)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
