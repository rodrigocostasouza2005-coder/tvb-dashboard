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

export type FamiliaBarRow = { familia: string; receitaLiquida: number; cmv: number; lucroBruto: number; margemPct: number | null };

// Barras agrupadas Receita líquida x CMV por família — ordenado por receita (já vem ordenado do
// server), rótulos do eixo X inclinados porque o Radar tem até ~24 famílias hoje (não cabe
// horizontal sem sobrepor).
export function ReceitaCmvBarChart({ data }: { data: FamiliaBarRow[] }) {
  if (data.length === 0) {
    return <div className="flex h-56 items-center justify-center text-sm text-[var(--text-muted)]">Sem dados no período/filtro.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={380}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 72 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey="familia"
          tick={{ fill: "var(--text-muted)", fontSize: 10 }}
          axisLine={{ stroke: "var(--gridline)" }}
          tickLine={false}
          angle={-45}
          textAnchor="end"
          interval={0}
          height={86}
        />
        <YAxis tickFormatter={(v) => formatBRLCompact(Number(v))} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={64} />
        <Tooltip
          contentStyle={tooltipStyle}
          content={({ active, payload, label }) => {
            if (!active || !payload || payload.length === 0) return null;
            const p = payload[0].payload as FamiliaBarRow;
            return (
              <div style={tooltipStyle}>
                <div className="mb-1 font-medium text-[var(--text-primary)]">{label}</div>
                <div>Receita líquida: {formatBRL(p.receitaLiquida)}</div>
                <div>CMV estimado: {formatBRL(p.cmv)}</div>
                <div>Lucro bruto: {formatBRL(p.lucroBruto)}</div>
                <div>Margem: {p.margemPct === null ? "—" : formatPercent(p.margemPct)}</div>
              </div>
            );
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="receitaLiquida" name="Receita líquida" fill="var(--series-1)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="cmv" name="CMV estimado" fill="var(--series-2)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export type MargemBarRow = { familia: string; margemPct: number | null };

// Margem bruta % por família — cor por faixa (crítico/atenção/bom), mesmos tokens de status
// usados no resto do Radar (ver statusFor em pesquisa-table.tsx), não uma paleta nova.
function corMargem(pct: number | null) {
  if (pct === null) return "var(--text-muted)";
  if (pct >= 40) return "var(--status-good)";
  if (pct >= 20) return "var(--status-warning)";
  return "var(--status-critical)";
}

// Ranking horizontal (maior → menor margem) em vez de barras verticais — com ~24 famílias as
// barras verticais ficavam finas demais e as diferenças de margem quase imperceptíveis. Barra
// horizontal dá mais espaço pro nome da família e pra régua de % (eixo X), que é o que
// realmente precisa ser comparável aqui.
export function MargemBarChart({ data }: { data: MargemBarRow[] }) {
  const comMargem = [...data].filter((d) => d.margemPct !== null).sort((a, b) => (b.margemPct as number) - (a.margemPct as number));
  if (comMargem.length === 0) {
    return <div className="flex h-56 items-center justify-center text-sm text-[var(--text-muted)]">Sem receita no período/filtro pra calcular margem.</div>;
  }
  const height = Math.min(760, 48 + comMargem.length * 26);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={comMargem} layout="vertical" margin={{ top: 8, right: 24, left: 0, bottom: 8 }} barCategoryGap={6}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" horizontal={false} />
        <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="familia"
          tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
          axisLine={{ stroke: "var(--gridline)" }}
          tickLine={false}
          width={128}
        />
        <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatPercent(Number(value)), "Margem bruta"]} />
        <Bar dataKey="margemPct" name="Margem bruta" radius={[0, 3, 3, 0]} barSize={16}>
          {comMargem.map((d) => (
            <Cell key={d.familia} fill={corMargem(d.margemPct)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export type EficienciaRow = { familia: string; sellThrough: number; margemPct: number; receitaLiquida: number; cmv: number };

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
    <div>
      <ResponsiveContainer width="100%" height={380}>
        <ScatterChart margin={{ top: 16, right: 24, left: 8, bottom: 24 }}>
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
            label={{ value: "Sell-through", position: "insideBottom", offset: -10, fill: "var(--text-muted)", fontSize: 11 }}
          />
          <YAxis
            type="number"
            dataKey="margemPct"
            name="Margem bruta"
            unit="%"
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={52}
            label={{ value: "Margem %", angle: -90, position: "insideLeft", fill: "var(--text-muted)", fontSize: 11 }}
          />
          <ZAxis type="number" dataKey="receitaLiquida" range={[80, 600]} name="Receita líquida" />
          <ReferenceLine x={sellThroughMedio} stroke="var(--text-muted)" strokeDasharray="4 4" />
          <ReferenceLine y={margemMedia} stroke="var(--text-muted)" strokeDasharray="4 4" />
          <Tooltip
            contentStyle={tooltipStyle}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const p = payload[0].payload as EficienciaRow;
              return (
                <div style={tooltipStyle}>
                  <div className="mb-1 font-medium text-[var(--text-primary)]">{p.familia}</div>
                  <div>Receita líquida: {formatBRL(p.receitaLiquida)}</div>
                  <div>CMV estimado: {formatBRL(p.cmv)}</div>
                  <div>Margem bruta: {formatPercent(p.margemPct)}</div>
                  <div>Sell-through: {formatPercent(p.sellThrough)}</div>
                </div>
              );
            }}
          />
          <Scatter data={data} fill="var(--series-1)" fillOpacity={0.8} stroke="var(--series-1)" strokeWidth={1} />
        </ScatterChart>
      </ResponsiveContainer>
      {/* Legenda dos 4 quadrantes — mesmos rótulos/cores de statusFamilia em page.tsx, não uma
          classificação nova. Fora do SVG do gráfico de propósito, pra não poluir os pontos. */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--status-good)" }} />Margem e sell-through acima da média: eficiente</span>
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--status-warning)" }} />Só margem acima: atenção ao estoque · Só sell-through acima: revisar custo/preço</span>
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--status-critical)" }} />Nenhum acima da média: prioridade de revisão</span>
      </div>
    </div>
  );
}
