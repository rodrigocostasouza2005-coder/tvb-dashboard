"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const SERIES_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
];

function formatDay(day: string) {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

export function BrindesTrendChart({
  data,
  stores,
}: {
  data: Record<string, string | number>[];
  stores: string[];
}) {
  if (data.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-[var(--text-muted)]">
        Poucos dias no período para montar o gráfico.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={formatDay}
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={{ stroke: "var(--gridline)" }}
          tickLine={false}
          minTickGap={20}
        />
        <YAxis
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={30}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={(day) => `Dia ${formatDay(String(day))}`}
          formatter={(value, name) => [Number(value).toLocaleString("pt-BR") + " un", name]}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)", paddingTop: 8 }}
        />
        {stores.map((store, i) => (
          <Bar
            key={store}
            dataKey={store}
            stackId="a"
            fill={SERIES_COLORS[i % SERIES_COLORS.length]}
            radius={i === stores.length - 1 ? [3, 3, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
