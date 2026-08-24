"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function formatMonthShort(monthStr: string) {
  const [year, m] = monthStr.split("-");
  return `${MONTH_NAMES[parseInt(m) - 1]}/${year.slice(2)}`;
}

function formatValue(value: number, format: "currency" | "number" | "percent") {
  if (format === "currency") return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (format === "percent") return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  return value.toLocaleString("pt-BR");
}

type Series = { key: string; name: string; color: string };

export function IndicatorChart({
  data,
  series,
  format,
}: {
  data: Record<string, string | number>[];
  series: Series[];
  format: "currency" | "number" | "percent";
}) {
  if (data.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-[var(--text-muted)]">
        Poucos meses no período pra montar o gráfico.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey="month"
          tickFormatter={formatMonthShort}
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={{ stroke: "var(--gridline)" }}
          tickLine={false}
          minTickGap={16}
        />
        <YAxis
          tickFormatter={(v) => (format === "currency" ? `${(Number(v) / 1000).toFixed(0)}k` : format === "percent" ? `${v}%` : String(v))}
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={(m) => formatMonthShort(String(m))}
          formatter={(value, name) => [formatValue(Number(value ?? 0), format), name]}
        />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={{ r: 3, fill: s.color }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
