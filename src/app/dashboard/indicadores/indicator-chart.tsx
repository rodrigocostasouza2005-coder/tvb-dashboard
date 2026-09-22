"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function formatMonthShort(monthStr: string) {
  const [year, m] = monthStr.split("-");
  return `${MONTH_NAMES[parseInt(m) - 1]}/${year.slice(2)}`;
}

function formatDayShort(dayStr: string) {
  const [, m, d] = dayStr.split("-");
  return `${d}/${m}`;
}

// "01".."12" → "Jan".."Dez", sem ano — pra comparar o mesmo mês entre anos diferentes lado a
// lado no eixo X (ver granularity "monthOfYear" abaixo), diferente de formatMonthShort que
// sempre amarra o rótulo a um "YYYY-MM" específico de um único ano.
function formatMonthOfYear(mesStr: string) {
  return MONTH_NAMES[parseInt(mesStr, 10) - 1] ?? mesStr;
}

// "0", "1", "2"... → "d0", "d1", "d2" — usado na curva de vida da coleção (dias desde a 1ª
// venda), onde o eixo X é um número puro, não uma data de calendário.
function formatDiasDesde(diasStr: string) {
  return `d${diasStr}`;
}

// Mesma ideia de formatDiasDesde, em meses — visão "mês a mês" da curva de vida da coleção.
function formatMesesDesde(mesesStr: string) {
  return `M${mesesStr}`;
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
  granularity = "month",
}: {
  // null é aceito de propósito (2026-09-18, comparação ano-a-ano do cliente de Atacado) — mês
  // que o ano atual ainda não alcançou vira null, não 0, pra recharts cortar a linha em vez de
  // mostrar uma queda enganosa até zero (connectNulls fica false, o padrão).
  data: Record<string, string | number | null>[];
  series: Series[];
  format: "currency" | "number" | "percent";
  granularity?: "month" | "day" | "monthOfYear" | "dias" | "mesesVida";
}) {
  const xKey =
    granularity === "day" ? "day"
    : granularity === "monthOfYear" ? "mes"
    : granularity === "dias" ? "dias"
    : granularity === "mesesVida" ? "mesesVida"
    : "month";
  const tickFormatter =
    granularity === "day" ? formatDayShort
    : granularity === "monthOfYear" ? formatMonthOfYear
    : granularity === "dias" ? formatDiasDesde
    : granularity === "mesesVida" ? formatMesesDesde
    : formatMonthShort;

  if (data.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-[var(--text-muted)]">
        {granularity === "day" || granularity === "dias" ? "Poucos dias no período pra montar o gráfico." : "Poucos meses no período pra montar o gráfico."}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey={xKey}
          tickFormatter={tickFormatter}
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
          labelFormatter={(m) => tickFormatter(String(m))}
          formatter={(value, name) => [value === null || value === undefined ? "—" : formatValue(Number(value), format), name]}
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
