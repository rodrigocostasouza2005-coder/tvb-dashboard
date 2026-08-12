"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

function formatDay(day: string) {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

function formatBRLCompact(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return value.toFixed(0);
}

export function SalesTrendChart({
  data,
  showRevenue,
}: {
  data: { day: string; unitsSold: number; revenue: number }[];
  showRevenue: boolean;
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
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="unitsGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-2)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--series-2)" stopOpacity={0} />
          </linearGradient>
        </defs>
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
        {showRevenue && (
          <YAxis
            yAxisId="revenue"
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
              name === "revenue" ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : n.toLocaleString("pt-BR"),
              name === "revenue" ? "Receita" : "Unidades",
            ];
          }}
        />
        <Area
          yAxisId="units"
          type="monotone"
          dataKey="unitsSold"
          stroke="var(--series-1)"
          strokeWidth={2}
          fill="url(#unitsGradient)"
          name="unitsSold"
        />
        {showRevenue && (
          <Area
            yAxisId="revenue"
            type="monotone"
            dataKey="revenue"
            stroke="var(--series-2)"
            strokeWidth={2}
            fill="url(#revenueGradient)"
            name="revenue"
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
