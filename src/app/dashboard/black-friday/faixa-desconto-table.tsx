import type { FaixaDescontoRow } from "@/lib/metrics";
import { formatBRL, formatNumber } from "@/lib/format";

// Painel "vendas por faixa de desconto real" (pedido do Rodrigo, 2026-11-06) — cruza venda
// líquida do período com o desconto REAL cadastrado por produto na planilha de preços da Black
// Friday (ver getVendasPorFaixaDesconto em black-friday.ts). "Sem desconto cadastrado" é uma
// linha própria, nunca escondida nem somada como 0% — mesmo padrão de "exibição honesta de dado
// faltante" já usado na tabela Produtos (SEM_CLASSIFICACAO).
export function FaixaDescontoTable({ rows, showFinancials }: { rows: FaixaDescontoRow[]; showFinancials: boolean }) {
  const totalUnidades = rows.reduce((s, r) => s + r.unitsSold, 0);
  const totalReceita = rows.reduce((s, r) => s + r.revenue, 0);

  return (
    <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Desconto</th>
            <th className="px-4 py-2 font-medium text-right">Peças líquidas</th>
            <th className="px-4 py-2 font-medium text-right">Produtos distintos</th>
            {showFinancials && <th className="px-4 py-2 font-medium text-right">Receita líquida</th>}
            {showFinancials && <th className="px-4 py-2 font-medium text-right">Preço médio líquido</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.desconto ?? "sem-cadastro"}
              className={`border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)] ${
                r.desconto == null ? "text-[var(--status-warning)]" : ""
              }`}
            >
              <td className="px-4 py-2 font-medium" title={r.desconto == null ? "Produto vendido no período sem linha correspondente na planilha de preços da Black Friday." : undefined}>
                {r.label}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.unitsSold)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.produtosDistintos)}</td>
              {showFinancials && <td className="px-4 py-2 text-right tabular-nums">{formatBRL(r.revenue)}</td>}
              {showFinancials && (
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                  {r.precoMedioLiquido != null ? formatBRL(r.precoMedioLiquido) : "—"}
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={showFinancials ? 5 : 3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                Nenhuma faixa de desconto cadastrada ainda.
              </td>
            </tr>
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-[var(--gridline)] font-medium">
              <td className="px-4 py-2">Soma das {rows.length} faixas acima</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatNumber(totalUnidades)}</td>
              <td className="px-4 py-2 text-right" />
              {showFinancials && <td className="px-4 py-2 text-right tabular-nums">{formatBRL(totalReceita)}</td>}
              {showFinancials && <td className="px-4 py-2 text-right" />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
