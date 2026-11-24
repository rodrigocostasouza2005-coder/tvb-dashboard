const STATUS_COLOR: Record<string, string> = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  critical: "var(--status-critical)",
};

export function StatTile({
  label,
  value,
  subValue,
  status,
  trend,
}: {
  label: string;
  value: string;
  subValue?: string;
  status?: "good" | "warning" | "critical";
  // Seta indicando direção — hoje só "up" (verde) é usado (ex: clientes novos > 0).
  trend?: "up" | "down";
}) {
  return (
    // min-w-0 é o que importa aqui: sem isso, um grid item (grid-cols-2 no celular) não
    // encolhe abaixo da largura "natural" do conteúdo — um valor grande (ex: "R$ 130.000,00")
    // empurrava o card pra fora da coluna e vazava da tela (achado pelo Rodrigo em 2026-09-18,
    // em várias abas ao mesmo tempo, não só uma).
    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
      <div className="text-xs font-medium text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 break-words text-xl font-semibold tabular-nums text-[var(--text-primary)] sm:text-2xl">
          {value}
        </span>
        {status && (
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: STATUS_COLOR[status] }}
          />
        )}
        {trend && (
          <span
            aria-hidden
            className="text-base leading-none"
            style={{ color: trend === "up" ? "var(--status-good)" : "var(--status-critical)" }}
          >
            {trend === "up" ? "▲" : "▼"}
          </span>
        )}
      </div>
      {subValue && (
        <div className="mt-0.5 text-xs tabular-nums text-[var(--text-muted)]">{subValue}</div>
      )}
    </div>
  );
}

// Versão compacta do StatTile acima pra números dentro de um card já aninhado (ex: 4 mini-stats
// dentro de um painel de produto) — StatTile inteiro (p-4, shadow, valor text-xl/2xl) é grande
// demais nesse contexto. Antes existiam DUAS cópias quase idênticas deste componente
// (planejamento-estoque/excesso-distribuicao.tsx e reposicao-bestseller.tsx) — unificado aqui pra
// não ter 2 versões levemente diferentes do mesmo mini-cartão de número espalhadas pelo código.
export function MiniStatTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning" | "critical";
}) {
  const color =
    tone === "critical" ? "var(--status-critical)" : tone === "warning" ? "var(--status-warning)" : "var(--text-primary)";
  return (
    <div className="rounded-md border border-[var(--gridline)] px-2.5 py-1.5">
      <div className="text-[10px] text-[var(--text-muted)]">{label}</div>
      <div className="text-sm font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
