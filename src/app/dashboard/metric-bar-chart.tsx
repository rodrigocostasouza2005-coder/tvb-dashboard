"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

function truncate(label: string, max = 18) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function formatValue(value: number, format: "number" | "currency") {
  return format === "currency"
    ? value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : value.toLocaleString("pt-BR");
}

// Gráfico de barras genérico de uma série só, usado nas abas onde o ranking já é o dado
// principal (Estoque Atual, Clientes, Vendedores, Marketing) — TopBarChart/BarCompare/
// SellthroughBarChart existem à parte porque têm regras específicas (unidades x receita,
// duas séries lado a lado, cor por status).
export function MetricBarChart({
  data,
  format = "number",
  color = "var(--series-1)",
  emptyMessage = "Sem dados para o período/filtro selecionado.",
}: {
  data: { key: string; value: number }[];
  format?: "number" | "currency";
  color?: string;
  emptyMessage?: string;
}) {
  if (data.length === 0) {
    return <div className="flex h-32 items-center justify-center text-sm text-[var(--text-muted)]">{emptyMessage}</div>;
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
          formatter={(value) => [formatValue(Number(value ?? 0), format), ""]}
        />
        <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}
