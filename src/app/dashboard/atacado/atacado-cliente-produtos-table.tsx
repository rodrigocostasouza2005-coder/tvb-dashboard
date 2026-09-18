type ProdutoRow = {
  produto: string;
  grupo: string;
  unidadesAtual: number;
  receitaAtual: number;
  unidadesAnterior: number;
  receitaAnterior: number;
  pedidos: number;
  ultimaCompra: string; // ISO, formatada aqui (server component — sem client JS necessário)
  status: "novo" | "perdido" | "normal";
};

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_LABEL: Record<ProdutoRow["status"], { label: string; color: string } | null> = {
  novo: { label: "Novo", color: "var(--status-good)" },
  perdido: { label: "Deixou de comprar", color: "var(--status-critical)" },
  normal: null,
};

// Produto | Ano anterior | Ano atual | Variação — pedido do Rodrigo em 2026-09-18, dentro da
// evolução de um cliente de Atacado. Tabela plana (não agrupada por grupo como
// AtacadoProdutosTable) de propósito: aqui o interesse é o produto individual mudando de ano
// pra ano, não o ranking geral por família. showReceita segue o mesmo padrão de
// AtacadoProdutosTable — quem não vê financeiro (canSeeFinancials=false) só vê unidades.
export function AtacadoClienteProdutosTable({
  rows,
  anoAtual,
  anoAnterior,
  showReceita = true,
}: {
  rows: ProdutoRow[];
  anoAtual: number;
  anoAnterior: number;
  showReceita?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Produto</th>
            <th className="px-4 py-2 font-medium text-right">{anoAnterior}</th>
            <th className="px-4 py-2 font-medium text-right">{anoAtual}</th>
            <th className="px-4 py-2 font-medium text-right">Variação</th>
            <th className="px-4 py-2 font-medium text-right">Pedidos</th>
            <th className="px-4 py-2 font-medium text-right">Última compra</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const variacaoReceita = r.receitaAtual - r.receitaAnterior;
            const variacaoUnidades = r.unidadesAtual - r.unidadesAnterior;
            const variacao = showReceita ? variacaoReceita : variacaoUnidades;
            const badge = STATUS_LABEL[r.status];
            return (
              <tr key={r.produto} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                <td className="px-4 py-2">
                  <div className="font-medium text-[var(--text-primary)]">{r.produto}</div>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                    {r.grupo}
                    {badge && (
                      <span className="inline-flex items-center gap-1">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: badge.color }} />
                        <span style={{ color: badge.color }}>{badge.label}</span>
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                  {showReceita ? (
                    <>
                      {formatBRL(r.receitaAnterior)}
                      <div className="text-xs text-[var(--text-muted)]">{r.unidadesAnterior.toLocaleString("pt-BR")} un</div>
                    </>
                  ) : (
                    `${r.unidadesAnterior.toLocaleString("pt-BR")} un`
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-[var(--text-primary)]">
                  {showReceita ? (
                    <>
                      {formatBRL(r.receitaAtual)}
                      <div className="text-xs font-normal text-[var(--text-muted)]">{r.unidadesAtual.toLocaleString("pt-BR")} un</div>
                    </>
                  ) : (
                    `${r.unidadesAtual.toLocaleString("pt-BR")} un`
                  )}
                </td>
                <td
                  className="px-4 py-2 text-right tabular-nums font-medium"
                  style={{ color: variacao > 0 ? "var(--status-good)" : variacao < 0 ? "var(--status-critical)" : "var(--text-muted)" }}
                >
                  {variacao > 0 ? "+" : ""}
                  {showReceita ? formatBRL(variacao) : `${variacao.toLocaleString("pt-BR")} un`}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{r.pedidos}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                  {new Date(r.ultimaCompra).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-[var(--text-muted)]">Nenhum produto encontrado pra esse cliente no período.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
