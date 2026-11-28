"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type Linha = { tamanho: string; bestSellerPct: number; naoBestSellerPct: number };

// Best Seller x Não Best Seller (seção 5.4 do briefing) — 2 curvas de % de participação por
// tamanho, pra mostrar que a curva de demanda não precisa ser igual entre os 2 tipos de produto.
export function BestSellerChart({ linhas }: { linhas: Linha[] }) {
  if (linhas.length === 0) return <p className="text-xs text-[var(--text-muted)]">Sem dado suficiente para este recorte.</p>;

  const data = linhas.map((l) => ({
    tamanho: l.tamanho,
    "Best Seller": Math.round(l.bestSellerPct * 1000) / 10,
    "Não Best Seller": Math.round(l.naoBestSellerPct * 1000) / 10,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--gridline)" vertical={false} />
        <XAxis dataKey="tamanho" tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v}%`} />
        <Tooltip
          contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
          formatter={(value) => [`${value ?? 0}%`, undefined]}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-secondary)" }} />
        <Line type="monotone" dataKey="Best Seller" stroke="var(--status-good)" strokeWidth={2} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="Não Best Seller" stroke="var(--text-secondary)" strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
