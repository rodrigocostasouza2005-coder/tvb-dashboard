import type { ProdutoBlackFriday } from "@/lib/metrics";
import { formatBRL, formatNumber } from "@/lib/format";

const BADGE: Record<ProdutoBlackFriday["classificacao"], { label: string; className: string; title?: string }> = {
  BEST_SELLER: { label: "Best Seller", className: "bg-[var(--status-good)]/15 text-[var(--status-good)]" },
  DROP: { label: "Drop", className: "bg-[var(--series-1)]/15 text-[var(--series-1)]" },
  // Classificação vem da Coleção real do produto (Sale.colecao, campo do DAPIC) — coleção
  // "Bestseller" = Best Seller, qualquer outra coleção = Drop (regra pedida pelo Rodrigo em
  // 2026-11-05, ver montarProdutosBlackFriday em black-friday.ts). "Sem classificação" só
  // acontece quando o produto não tem NENHUMA venda com coleção preenchida no período — nunca é
  // inferida por volume/receita.
  SEM_CLASSIFICACAO: {
    label: "Sem coleção no período",
    className: "bg-[var(--status-warning)]/15 text-[var(--status-warning)]",
    title: "Nenhuma venda deste produto no período tem a Coleção preenchida — não há como classificar Best Seller/Drop sem esse dado.",
  },
};

// Item 4 da missão: classificação por Coleção (ver black-friday.ts) — não recalcula nada aqui,
// só rotula o ranking de venda do período com a classificação já resolvida.
export function ProdutosTable({ rows, showFinancials }: { rows: ProdutoBlackFriday[]; showFinancials: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">Produto</th>
            <th className="px-4 py-2 font-medium">Classificação</th>
            <th className="px-4 py-2 font-medium text-right">Peças líquidas</th>
            {showFinancials && <th className="px-4 py-2 font-medium text-right">Receita líquida</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const badge = BADGE[r.classificacao];
            return (
              <tr key={`${r.grupo}::${r.produto}`} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                <td className="px-4 py-2 text-[var(--text-muted)]">{i + 1}</td>
                <td className="px-4 py-2">
                  <div className="font-medium text-[var(--text-primary)]">{r.produto}</div>
                  <div className="text-xs text-[var(--text-muted)]">{r.grupo}</div>
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge.className}`} title={badge.title}>{badge.label}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.unitsSold)}</td>
                {showFinancials && <td className="px-4 py-2 text-right tabular-nums">{formatBRL(r.revenue)}</td>}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={showFinancials ? 5 : 4} className="px-4 py-6 text-center text-[var(--text-muted)]">Sem venda no período.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
