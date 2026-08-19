"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

type CidadeRow = {
  cidade: string;
  estado: string;
  receita: number;
  pedidos: number;
  unidades: number;
};

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function CidadesChart({ rows }: { rows: CidadeRow[] }) {
  const top15 = rows.slice(0, 15);

  if (top15.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-[var(--text-muted)]">
        Nenhuma cidade encontrada no período.
      </div>
    );
  }

  const height = Math.max(300, top15.length * 30);

  const data = [...top15].reverse().map((r) => ({
    name: `${r.cidade} (${r.estado})`,
    receita: r.receita,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" horizontal={false} />
        <YAxis
          dataKey="name"
          type="category"
          width={140}
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <XAxis
          type="number"
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={{ stroke: "var(--gridline)" }}
          tickLine={false}
          tickFormatter={(v) => `R$${(Number(v) / 1000).toFixed(0)}k`}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(value) => [formatBRL(Number(value)), "Receita"]}
        />
        <Bar dataKey="receita" fill="#2a78d6" radius={[0, 3, 3, 0]} name="Receita" />
      </BarChart>
    </ResponsiveContainer>
  );
}
