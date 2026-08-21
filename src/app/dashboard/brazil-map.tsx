"use client";

import { useState } from "react";
import { BRAZIL_STATES, BRAZIL_VIEWBOX } from "@/lib/brazil-states-geo";

type Row = { estado: string; receita: number; unidades: number };

const SCALE = ["var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)", "var(--seq-5)"];

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function BrazilMap({ rows }: { rows: Row[] }) {
  const [hover, setHover] = useState<{ uf: string; x: number; y: number } | null>(null);

  const byUf = new Map(rows.map((r) => [r.estado, r]));
  // Quantil em vez de linear: a receita é muito concentrada (RJ domina), então uma escala
  // linear deixaria todo o resto praticamente invisível. Por rank, os estados intermediários
  // também aparecem diferenciados.
  const sorted = [...rows].filter((r) => r.receita > 0).sort((a, b) => a.receita - b.receita);
  const rankByUf = new Map(sorted.map((r, i) => [r.estado, i / Math.max(1, sorted.length - 1)]));

  function colorFor(uf: string) {
    const row = byUf.get(uf);
    if (!row || row.receita <= 0) return "var(--map-empty)";
    const t = rankByUf.get(uf) ?? 0;
    const idx = Math.min(SCALE.length - 1, Math.floor(t * SCALE.length));
    return SCALE[idx];
  }

  const hoveredRow = hover ? byUf.get(hover.uf) : null;
  const hoveredName = hover ? BRAZIL_STATES.find((s) => s.uf === hover.uf)?.name : null;

  return (
    <div className="relative">
      <svg
        viewBox={BRAZIL_VIEWBOX}
        className="w-full max-h-[420px]"
        role="img"
        aria-label="Mapa do Brasil colorido por receita de atacado por estado"
      >
        {BRAZIL_STATES.map((s) => (
          <path
            key={s.uf}
            d={s.path}
            fill={colorFor(s.uf)}
            stroke="var(--surface-1)"
            strokeWidth={1}
            onMouseMove={(e) => {
              const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
              setHover({ uf: s.uf, x: e.clientX - rect.left, y: e.clientY - rect.top });
            }}
            onMouseLeave={() => setHover((h) => (h?.uf === s.uf ? null : h))}
            style={{ cursor: "pointer", transition: "fill 0.15s" }}
          />
        ))}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: hover.x + 12,
            top: hover.y + 12,
            background: "var(--surface-1)",
            borderColor: "var(--border)",
            color: "var(--text-primary)",
          }}
        >
          <div className="font-medium">{hoveredName ?? hover.uf}</div>
          {hoveredRow ? (
            <>
              <div className="text-[var(--text-secondary)]">{formatBRL(hoveredRow.receita)}</div>
              <div className="text-[var(--text-muted)]">{hoveredRow.unidades.toLocaleString("pt-BR")} unidades</div>
            </>
          ) : (
            <div className="text-[var(--text-muted)]">Sem vendas no período</div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <span>Menos</span>
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--map-empty)" }} />
        {SCALE.map((c) => (
          <span key={c} className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c }} />
        ))}
        <span>Mais</span>
        <span className="ml-2">— receita por estado</span>
      </div>
    </div>
  );
}
