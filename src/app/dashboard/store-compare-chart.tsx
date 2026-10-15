"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

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

function formatDay(day: string) {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

// xKey/tickFormatter/labelPrefix/minPoints: generalizados em 2026-10-15 (pedido do Rodrigo —
// "hora de compra por loja", parecido com esse gráfico só que no eixo X em vez de dia) pra
// reaproveitar o mesmo componente em vez de duplicar. Comportamento padrão (sem passar nada)
// continua idêntico ao original: eixo "day" formatado dd/mm.
export function StoreCompareChart({
  data,
  series,
  xKey = "day",
  tickFormatter = formatDay,
  labelPrefix = "Dia ",
  minPoints = 2,
  emptyMessage = "Poucos dias no período selecionado pra comparar lojas.",
}: {
  data: Record<string, string | number>[];
  series: string[];
  xKey?: string;
  tickFormatter?: (v: string) => string;
  labelPrefix?: string;
  minPoints?: number;
  emptyMessage?: string;
}) {
  if (data.length < minPoints || series.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--text-muted)]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey={xKey}
          tickFormatter={tickFormatter}
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={{ stroke: "var(--gridline)" }}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
        <Tooltip
          contentStyle={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={(v) => `${labelPrefix}${tickFormatter(String(v))}`}
          formatter={(value) => Number(value ?? 0).toLocaleString("pt-BR")}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((name, i) => (
          <Line
            key={name}
            type="monotone"
            dataKey={name}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
