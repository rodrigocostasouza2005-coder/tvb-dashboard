"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ZAxis,
  ReferenceLine,
  Cell,
} from "recharts";
import { formatBRL, formatBRLCompact, formatPercent } from "@/lib/format";

const tooltipStyle = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  padding: "8px 12px",
};

export type FamiliaBarRow = { familia: string; receitaLiquida: number; cmv: number };

// Barras agrupadas Receita líquida x CMV por família — ordenado por receita (já vem ordenado do
// server), rótulos do eixo X inclinados porque o Radar tem até ~24 famílias hoje (não cabe
// horizontal sem sobrepor).
export function ReceitaCmvBarChart({ data }: { data: FamiliaBarRow[] }) {
  if (data.length === 0) {
    return <div className="flex h-56 items-center justify-center text-sm text-[var(--text-muted)]">Sem dados no período/filtro.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 56 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey="familia"
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={{ stroke: "var(--gridline)" }}
          tickLine={false}
          angle={-40}
          textAnchor="end"
          interval={0}
          height={70}
        />
        <YAxis tickFormatter={(v) => formatBRLCompact(Number(v))} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={64} />
        <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [formatBRL(Number(value)), name]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="receitaLiquida" name="Receita líquida" fill="var(--series-1)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="cmv" name="CMV estimado" fill="var(--series-2)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export type MargemBarRow = { familia: string; margemPct: number | null };

// Margem % por família — cor por faixa (crítico/atenção/bom), mesmos tokens de status usados no
// resto do Radar (ver statusFor em pesquisa-table.tsx), não uma paleta nova.
function corMargem(pct: number | null) {
  if (pct === null) return "var(--text-muted)";
  if (pct >= 40) return "var(--status-good)";
  if (pct >= 20) return "var(--status-warning)";
  return "var(--status-critical)";
}

export function MargemBarChart({ data }: { data: MargemBarRow[] }) {
  const comMargem = data.filter((d) => d.margemPct !== null);
  if (comMargem.length === 0) {
    return <div className="flex h-56 items-center justify-center text-sm text-[var(--text-muted)]">Sem receita no período/filtro pra calcular margem.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={comMargem} margin={{ top: 8, right: 12, left: 0, bottom: 56 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey="familia"
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={{ stroke: "var(--gridline)" }}
          tickLine={false}
          angle={-40}
          textAnchor="end"
          interval={0}
          height={70}
        />
        <YAxis tickFormatter={(v) => `${v}%`} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
        <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatPercent(Number(value))} />
        <Bar dataKey="margemPct" name="Margem bruta" radius={[3, 3, 0, 0]}>
          {comMargem.map((d) => (
            <Cell key={d.familia} fill={corMargem(d.margemPct)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export type EficienciaRow = { familia: string; sellThrough: number; margemPct: number; receitaLiquida: number };

// Matriz de eficiência: X = sell-through, Y = margem %, tamanho do ponto = receita líquida.
// Linhas de referência nas médias (não em limiares fixos) pra dividir os 4 quadrantes — ver
// comentário em page.tsx sobre por que "alta/baixa" é relativo à média das famílias do período,
// não um número absoluto inventado.
export function EficienciaScatterChart({
  data,
  margemMedia,
  sellThroughMedio,
}: {
  data: EficienciaRow[];
  margemMedia: number;
  sellThroughMedio: number;
}) {
  if (data.length === 0) {
    return <div className="flex h-72 items-center justify-center text-sm text-[var(--text-muted)]">Sem famílias com margem e sell-through calculáveis no período/filtro.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={360}>
      <ScatterChart margin={{ top: 16, right: 24, left: 8, bottom: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" />
        <XAxis
          type="number"
          dataKey="sellThrough"
          name="Sell-through"
          unit="%"
          domain={[0, 100]}
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={{ stroke: "var(--gridline)" }}
          tickLine={false}
          label={{ value: "Sell-through", position: "insideBottom", offset: -8, fill: "var(--text-muted)", fontSize: 11 }}
        />
        <YAxis
          type="number"
          dataKey="margemPct"
          name="Margem bruta"
          unit="%"
          tick={{ fill: "var(--text-muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={48}
          label={{ value: "Margem %", angle: -90, position: "insideLeft", fill: "var(--text-muted)", fontSize: 11 }}
        />
        <ZAxis type="number" dataKey="receitaLiquida" range={[60, 500]} name="Receita líquida" />
        <ReferenceLine x={sellThroughMedio} stroke="var(--gridline)" strokeDasharray="4 4" />
        <ReferenceLine y={margemMedia} stroke="var(--gridline)" strokeDasharray="4 4" />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => {
            if (name === "Sell-through" || name === "Margem bruta") return [`${Number(value).toFixed(1)}%`, name];
            if (name === "Receita líquida") return [formatBRL(Number(value)), name];
            return [String(value), name];
          }}
          labelFormatter={() => ""}
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;
            const p = payload[0].payload as EficienciaRow;
            return (
              <div style={tooltipStyle}>
                <div className="mb-1 font-medium text-[var(--text-primary)]">{p.familia}</div>
                <div>Sell-through: {p.sellThrough.toFixed(1)}%</div>
                <div>Margem bruta: {p.margemPct.toFixed(1)}%</div>
                <div>Receita líquida: {formatBRL(p.receitaLiquida)}</div>
              </div>
            );
          }}
        />
        <Scatter data={data} fill="var(--series-1)" fillOpacity={0.75} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
