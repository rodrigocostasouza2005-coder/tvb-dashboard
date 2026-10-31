import type { RecomendacaoConsolidadaProduto } from "@/lib/metrics";

function formatNum(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR");
}

// Painel COMPLEMENTAR (seção 5 do pedido de 2026-10-31) — nunca substitui a "Quantidade sugerida
// de compra" que já aparece na linha do produto (LinhaRecomendacao, mapa-compras-grid.tsx); esse
// número vem da Inteligência de Compras, rede inteira, e continua intocado. Este painel mostra a
// visão COMPLEMENTAR por loja (necessidade real nas lojas, quanto é resolvível só reorganizando
// estoque existente via transferência, e o que sobra de necessidade real depois disso) — só
// aparece quando há evidência (ver combinarRecomendacaoConsolidada, que já filtra isso).
export function ConsolidadoProdutoPanel({ c }: { c: RecomendacaoConsolidadaProduto }) {
  const corCompraFinal =
    c.compraFinalRecomendada == null ? "var(--status-warning)" : c.compraFinalRecomendada === 0 ? "var(--status-good)" : "var(--status-critical)";
  const labelCompraFinal =
    c.compraFinalRecomendada == null ? "pendente de confirmação humana" : `${formatNum(c.compraFinalRecomendada)} un.`;

  return (
    <details className="my-1 rounded-md border border-[var(--border)] bg-[var(--surface-1)]">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
        <span className="font-medium text-[var(--text-secondary)]">Recomendação consolidada (considera estoque nas lojas)</span>
        <span
          className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ backgroundColor: `color-mix(in srgb, ${corCompraFinal} 15%, transparent)`, color: corCompraFinal }}
        >
          compra residual: {labelCompraFinal}
        </span>
      </summary>
      <div className="border-t border-[var(--border)] p-3 text-xs">
        <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <div className="text-[10px] text-[var(--text-muted)]">Necessidade identificada</div>
            <div className="tabular-nums font-medium text-[var(--text-primary)]">{formatNum(c.necessidadeIdentificada)} un.</div>
          </div>
          <div>
            <div className="text-[10px] text-[var(--text-muted)]">Estoque disponível na rede</div>
            <div className="tabular-nums font-medium text-[var(--text-primary)]">{formatNum(c.estoqueDisponivelNaRede)} un.</div>
          </div>
          <div>
            <div className="text-[10px] text-[var(--text-muted)]">Transferível entre lojas</div>
            <div className="tabular-nums font-medium text-[var(--text-primary)]">{formatNum(c.quantidadeTransferivel)} un.</div>
          </div>
          <div>
            <div className="text-[10px] text-[var(--text-muted)]">Necessidade residual</div>
            <div className="tabular-nums font-medium" style={{ color: c.necessidadeResidual > 0 ? "var(--status-critical)" : "var(--status-good)" }}>
              {formatNum(c.necessidadeResidual)} un.
            </div>
          </div>
        </div>

        {c.transferencias.length > 0 && (
          <div className="mb-2">
            <div className="mb-1 text-[10px] font-medium text-[var(--text-muted)]">Transferências recomendadas</div>
            <ul className="space-y-1">
              {c.transferencias.map((t, i) => (
                <li key={i} className="rounded-md border border-[var(--gridline)] px-2 py-1">
                  {t.cor ? `${t.cor} · ` : ""}
                  {t.tamanho ?? "—"}: <strong>{t.lojaOrigem}</strong> → <strong>{t.lojaDestino}</strong>, {formatNum(t.quantidadeSugerida)} un.
                </li>
              ))}
            </ul>
          </div>
        )}

        <ul className="list-disc space-y-0.5 pl-4 text-[var(--text-muted)]">
          {c.justificativa.map((j, i) => (
            <li key={i}>{j}</li>
          ))}
        </ul>

        <p className="mt-2 border-t border-[var(--gridline)] pt-2 text-[10px] text-[var(--text-muted)]">
          Nota técnica: a "Quantidade sugerida de compra" mostrada acima (Inteligência de Compras)
          já considera o estoque da rede inteira somado — transferir estoque entre lojas não
          cria unidade nova, então não reduz aquele número. A "necessidade residual" aqui é outra
          métrica: o que falta especificamente nas lojas que estão em ruptura, depois de já contar
          o que pode ser resolvido só reorganizando estoque que já existe.
        </p>
      </div>
    </details>
  );
}
