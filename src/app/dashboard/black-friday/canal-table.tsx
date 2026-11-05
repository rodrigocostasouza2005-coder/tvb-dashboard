import type { CanalVendasRow } from "@/lib/metrics";
import { formatBRL, formatNumber } from "@/lib/format";

// Item 2 da missão: Site(CD)/Leblon/Rio Sul/Barra/Atacado SEMPRE em linhas separadas — nunca
// uma linha "Total" escondendo qual canal fez o quê. A linha de soma no fim é só um apoio visual
// (mantém a origem de cada canal visível em cima dela, nunca no lugar dela).
export function CanalTable({ rows, showFinancials }: { rows: CanalVendasRow[]; showFinancials: boolean }) {
  const totalUnidades = rows.reduce((s, r) => s + r.unitsSold, 0);
  const totalReceita = rows.reduce((s, r) => s + r.revenue, 0);
  const totalPedidos = rows.reduce((s, r) => s + r.pedidos, 0);

  return (
    <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Canal</th>
            <th className="px-4 py-2 font-medium text-right">Peças líquidas</th>
            <th className="px-4 py-2 font-medium text-right">Pedidos</th>
            {showFinancials && <th className="px-4 py-2 font-medium text-right">Faturamento líquido</th>}
            {showFinancials && <th className="px-4 py-2 font-medium text-right">Ticket médio</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.storeId} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
              <td className="px-4 py-2 font-medium">{r.nome}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.unitsSold)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.pedidos)}</td>
              {showFinancials && <td className="px-4 py-2 text-right tabular-nums">{formatBRL(r.revenue)}</td>}
              {showFinancials && (
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                  {r.ticketMedio != null ? formatBRL(r.ticketMedio) : "—"}
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={showFinancials ? 5 : 3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                Nenhuma loja encontrada.
              </td>
            </tr>
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-[var(--gridline)] font-medium">
              <td className="px-4 py-2">Soma dos {rows.length} canais acima</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatNumber(totalUnidades)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatNumber(totalPedidos)}</td>
              {showFinancials && <td className="px-4 py-2 text-right tabular-nums">{formatBRL(totalReceita)}</td>}
              {showFinancials && <td className="px-4 py-2 text-right" />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
