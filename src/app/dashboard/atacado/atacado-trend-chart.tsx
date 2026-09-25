"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function formatMonth(month: string) {
  const [y, m] = month.split("-");
  return `${MESES[Number(m) - 1]}/${y.slice(2)}`;
}

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function AtacadoTrendChart({ data }: { data: { month: string; units: number; revenue: number }[] }) {
  if (data.length < 2) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-[var(--text-muted)]">
        Poucos meses no histórico para montar o gráfico.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey="month"
          tickFormatter={formatMonth}
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={{ stroke: "var(--gridline)" }}
          tickLine={false}
          minTickGap={20}
        />
        <YAxis
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={70}
          tickFormatter={(v) => `R$${(Number(v) / 1000).toFixed(0)}k`}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={(month) => formatMonth(String(month))}
          formatter={(value) => [formatBRL(Number(value)), "Receita bruta"]}
        />
        <Bar dataKey="revenue" fill="#2a78d6" radius={[3, 3, 0, 0]} name="Receita bruta" />
      </BarChart>
    </ResponsiveContainer>
  );
}
