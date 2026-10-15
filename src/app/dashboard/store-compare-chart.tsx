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

function formatHora(h: string) {
  return `${h}h`;
}

// variant: adicionado em 2026-10-15 (pedido do Rodrigo — "hora de compra por loja", parecido com
// esse gráfico só que no eixo X em vez de dia) pra reaproveitar o mesmo componente em vez de
// duplicar. String fixa em vez de aceitar função: este é um Client Component ("use client") e
// StoreCompareChart é renderizado a partir de Server Components (as páginas) — passar uma função
// (tickFormatter) de um Server Component pra um Client Component quebra a página inteira ("Functions
// cannot be passed directly to Client Components"), achado ao vivo rodando local depois do Rodrigo
// reportar a aba de Vendas inteira fora do ar. Mesmo padrão já usado em IndicatorChart
// (granularity: string, nunca uma função recebida de fora).
const VARIANTS = {
  day: { xKey: "day", tickFormatter: formatDay, labelPrefix: "Dia ", emptyMessage: "Poucos dias no período selecionado pra comparar lojas." },
  hora: { xKey: "hora", tickFormatter: formatHora, labelPrefix: "", emptyMessage: "Sem venda no período selecionado." },
} as const;

export function StoreCompareChart({
  data,
  series,
  variant = "day",
  minPoints = 2,
}: {
  data: Record<string, string | number>[];
  series: string[];
  variant?: keyof typeof VARIANTS;
  minPoints?: number;
}) {
  const { xKey, tickFormatter, labelPrefix, emptyMessage } = VARIANTS[variant];

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
