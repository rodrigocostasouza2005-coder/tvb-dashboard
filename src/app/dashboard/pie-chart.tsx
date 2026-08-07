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

export function PieChart({
  data,
}: {
  data: { label: string; value: number; percentual: number }[];
}) {
  // No máximo 8 fatias (mesmo limite da paleta categórica) — o resto vira "Outros".
  const top = data.slice(0, 7);
  const rest = data.slice(7);
  const outros = rest.reduce((sum, d) => sum + d.value, 0);
  const outrosPct = rest.reduce((sum, d) => sum + d.percentual, 0);
  const slices = outros > 0 ? [...top, { label: "Outros", value: outros, percentual: outrosPct }] : top;

  let cumulative = 0;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg
        viewBox="0 0 40 40"
        width={180}
        height={180}
        style={{ transform: "rotate(-90deg)" }}
        role="img"
        aria-label="Distribuição de estoque por armazenador"
      >
        <circle cx={20} cy={20} r={15.915} fill="none" stroke="var(--gridline)" strokeWidth={8} />
        {slices.map((s, i) => {
          const dash = s.percentual;
          const offset = -cumulative;
          cumulative += dash;
          return (
            <circle
              key={s.label}
              cx={20}
              cy={20}
              r={15.915}
              fill="none"
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={8}
              strokeDasharray={`${dash} ${100 - dash}`}
              strokeDashoffset={offset}
              pathLength={100}
            />
          );
        })}
      </svg>

      <ul className="flex flex-col gap-1.5 text-sm">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="text-[var(--text-primary)]">{s.label}</span>
            <span className="tabular-nums text-[var(--text-muted)]">
              {s.value.toLocaleString("pt-BR")} ({s.percentual.toFixed(0)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
