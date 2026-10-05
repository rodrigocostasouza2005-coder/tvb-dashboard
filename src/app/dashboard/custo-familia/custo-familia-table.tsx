import { formatBRL, formatNumber, formatPercent } from "@/lib/format";

export type FamiliaRow = {
  familia: string;
  receitaLiquida: number;
  cmv: number;
  lucroBruto: number;
  margemPct: number | null;
  unidadesLiquidas: number;
  estoqueAtual: number;
  valorEstoqueCusto: number;
  custoPorPeca: number | null;
  precoMedio: number | null;
  sellThrough: number | null;
  unidadesSemCusto: number;
  status: { label: string; color: string };
};

// "—" = métrica não aplicável (ex: margem sem receita no período) — diferente de 0, que é um
// valor real (ex: família com receita líquida de R$ 0 depois de descontar devolução). Nunca
// troca 0 por "—" aqui.
function cellBRL(v: number | null) {
  return v === null ? <span className="text-[var(--text-muted)]">—</span> : formatBRL(v);
}
function cellPct(v: number | null) {
  return v === null ? <span className="text-[var(--text-muted)]">—</span> : formatPercent(v);
}

export function CustoFamiliaTable({ rows }: { rows: FamiliaRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Nenhuma família no período/filtro selecionado.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Família</th>
            <th className="px-3 py-2 font-medium">Receita líquida</th>
            <th className="px-3 py-2 font-medium">CMV estimado</th>
            <th className="px-3 py-2 font-medium">Lucro bruto</th>
            <th className="px-3 py-2 font-medium">Margem %</th>
            <th className="px-3 py-2 font-medium">Vendido</th>
            <th className="px-3 py-2 font-medium">Estoque atual</th>
            <th className="px-3 py-2 font-medium">Estoque a custo</th>
            <th className="px-3 py-2 font-medium">Custo/peça</th>
            <th className="px-3 py-2 font-medium">Preço médio</th>
            <th className="px-3 py-2 font-medium">Sell-through</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.familia} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
              <td className="px-4 py-2 font-medium text-[var(--text-primary)]">
                {r.familia}
                {r.unidadesSemCusto > 0 && (
                  <span
                    className="ml-1.5 text-[10px] text-[var(--text-muted)]"
                    title={`${formatNumber(r.unidadesSemCusto)} unidade(s) vendida(s) sem custo conhecido (SKU nunca apareceu num snapshot de estoque) — não entraram no CMV estimado.`}
                  >
                    ⚠
                  </span>
                )}
              </td>
              <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{cellBRL(r.receitaLiquida)}</td>
              <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{cellBRL(r.cmv)}</td>
              <td className="px-3 py-2 tabular-nums font-medium text-[var(--text-primary)]">{cellBRL(r.lucroBruto)}</td>
              <td className="px-3 py-2 tabular-nums font-semibold text-[var(--text-primary)]">{cellPct(r.margemPct)}</td>
              <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{formatNumber(r.unidadesLiquidas)}</td>
              <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{formatNumber(r.estoqueAtual)}</td>
              <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{cellBRL(r.valorEstoqueCusto)}</td>
              <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{cellBRL(r.custoPorPeca)}</td>
              <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{cellBRL(r.precoMedio)}</td>
              <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{cellPct(r.sellThrough)}</td>
              <td className="px-3 py-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: `color-mix(in srgb, ${r.status.color} 15%, transparent)`, color: r.status.color }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.status.color }} />
                  {r.status.label}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
