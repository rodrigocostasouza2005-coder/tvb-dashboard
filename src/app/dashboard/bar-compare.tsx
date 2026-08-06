type Row = { label: string; a: number; b: number };

export function BarCompare({
  rows,
  labelA,
  labelB,
}: {
  rows: Row[];
  labelA: string;
  labelB: string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]));

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
      <div className="mb-4 flex items-center gap-4 text-xs text-[var(--text-secondary)]">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--series-1)" }} />
          {labelA}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--series-2)" }} />
          {labelB}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="mb-1 text-xs font-medium text-[var(--text-primary)]">{r.label}</div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 rounded-full bg-[var(--gridline)]">
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${(r.a / max) * 100}%`, backgroundColor: "var(--series-1)" }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-[var(--text-secondary)]">
                  {r.a.toLocaleString("pt-BR")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 rounded-full bg-[var(--gridline)]">
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${(r.b / max) * 100}%`, backgroundColor: "var(--series-2)" }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-[var(--text-secondary)]">
                  {r.b.toLocaleString("pt-BR")}
                </span>
              </div>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">Sem dados para o período/filtro selecionado.</p>
        )}
      </div>
    </div>
  );
}
