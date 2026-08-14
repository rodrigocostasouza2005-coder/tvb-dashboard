"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

function formatDay(day: string) {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

function formatBRLCompact(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return value.toFixed(0);
}

export function ReturnsTrendChart({
  data,
  showValue,
}: {
  data: { day: string; unitsReturned: number; value: number }[];
  showValue: boolean;
}) {
  if (data.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--text-muted)]">
        Poucos dias no período selecionado pra montar um gráfico de tendência.
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
          minTickGap={24}
        />
        <YAxis
          yAxisId="units"
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        {showValue && (
          <YAxis
            yAxisId="value"
            orientation="right"
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatBRLCompact}
            width={40}
          />
        )}
        <Tooltip
          contentStyle={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={(day) => `Dia ${formatDay(String(day))}`}
          formatter={(value, name) => {
            const n = Number(value ?? 0);
            return [
              name === "value"
                ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                : n.toLocaleString("pt-BR"),
              name === "value" ? "Valor devolvido" : "Unidades",
            ];
          }}
        />
        <Bar
          yAxisId="units"
          dataKey="unitsReturned"
          fill="var(--status-warning)"
          name="unitsReturned"
          radius={[3, 3, 0, 0]}
          maxBarSize={32}
        />
        {showValue && (
          <Bar
            yAxisId="value"
            dataKey="value"
            fill="var(--status-critical)"
            name="value"
            radius={[3, 3, 0, 0]}
            maxBarSize={32}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
