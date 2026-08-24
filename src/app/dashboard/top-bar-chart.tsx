"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from "recharts";

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

function truncate(label: string, max = 18) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export function TopBarChart({
  data,
  valueKey,
  showCurrency,
}: {
  data: { key: string; unitsSold: number; revenue: number }[];
  valueKey: "unitsSold" | "revenue";
  showCurrency: boolean;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--text-muted)]">
        Sem vendas no período/filtro selecionado.
      </div>
    );
  }

  const rows = data.map((d) => ({ ...d, label: truncate(d.key) }));
  const height = Math.max(rows.length * 34, 120);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
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
          labelFormatter={(_, payload) => payload?.[0]?.payload?.key ?? ""}
          formatter={(value) => {
            const n = Number(value ?? 0);
            return [
              showCurrency ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : n.toLocaleString("pt-BR"),
              showCurrency ? "Receita bruta" : "Unidades brutas",
            ];
          }}
        />
        <Bar dataKey={valueKey} radius={[0, 4, 4, 0]} maxBarSize={20}>
          {rows.map((r, i) => (
            <Cell key={r.key} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
