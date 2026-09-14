"use client";

import { useState } from "react";
import { BRAZIL_STATES, BRAZIL_VIEWBOX } from "@/lib/brazil-states-geo";

type Row = { estado: string; receita: number; unidades: number };
type CityRow = { cidade: string; receita: number; unidades: number };

const SCALE = ["var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)", "var(--seq-5)"];

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

// citiesByState opcional: quando vem preenchido, clicar num estado abre um dropdown com as
// cidades daquele estado (em vez de precisar navegar pra outra aba/tabela) — pedido do Rodrigo
// em 2026-09-14. Sem esse prop o mapa continua se comportando como antes (só hover).
export function BrazilMap({ rows, citiesByState }: { rows: Row[]; citiesByState?: Map<string, CityRow[]> }) {
  const [hover, setHover] = useState<{ uf: string; x: number; y: number } | null>(null);
  const [selectedUf, setSelectedUf] = useState<string | null>(null);

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
            onClick={() => citiesByState && setSelectedUf((cur) => (cur === s.uf ? null : s.uf))}
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
        {citiesByState && <span className="ml-2">· clique num estado pra ver as cidades</span>}
      </div>

      {selectedUf && citiesByState && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 shadow-md">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-medium text-[var(--text-primary)]">
              {BRAZIL_STATES.find((s) => s.uf === selectedUf)?.name ?? selectedUf} — cidades
            </h4>
            <button
              type="button"
              onClick={() => setSelectedUf(null)}
              className="rounded-md px-1.5 text-[var(--text-muted)] hover:bg-[var(--page-plane)]"
              aria-label="Fechar"
            >
              ×
            </button>
          </div>
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
            {[...(citiesByState.get(selectedUf) ?? [])]
              .sort((a, b) => b.receita - a.receita)
              .map((c) => (
                <li key={c.cidade} className="flex items-center justify-between gap-3 border-b border-[var(--gridline)] py-1 last:border-0">
                  <span className="text-[var(--text-primary)]">{c.cidade}</span>
                  <span className="flex shrink-0 items-center gap-3 tabular-nums text-[var(--text-secondary)]">
                    <span>{formatBRL(c.receita)}</span>
                    <span className="text-[var(--text-muted)]">{c.unidades.toLocaleString("pt-BR")} un.</span>
                  </span>
                </li>
              ))}
            {(citiesByState.get(selectedUf) ?? []).length === 0 && (
              <li className="text-[var(--text-muted)]">Sem cidade identificada nesse estado no período.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
