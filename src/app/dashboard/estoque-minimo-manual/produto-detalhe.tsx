import type { ItemMinimoManual } from "@/lib/metrics";
import { formatNumero, NivelBadge } from "./format";
import { MinimoManualForm } from "./forms";

// Visão detalhada — 1 linha por tamanho (cada ItemMinimoManual já É um cod = produto+cor+
// tamanho). O mínimo NUNCA é avaliado por loja: a seção "onde está esse tamanho hoje" abaixo é só
// leitura (breakdown por posição), reaproveitando porLoja que já vem no item — nunca usado pra
// recalcular nível de alerta.
export function ProdutoDetalhe({
  produto,
  itens,
  podeEditar,
  fecharHref,
}: {
  produto: string;
  itens: ItemMinimoManual[]; // já filtrados pro produto aberto, na ordem crítico→atenção→sem mínimo→normal
  podeEditar: boolean;
  fecharHref: string;
}) {
  return (
    <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between border-b border-[var(--gridline)] px-4 py-2.5">
        <h2 className="text-sm font-medium text-[var(--text-secondary)]">
          Detalhe — {produto} <span className="text-[var(--text-muted)]">({itens.length} tamanho(s))</span>
        </h2>
        <a href={fecharHref} className="text-xs text-[var(--text-muted)] hover:underline">
          Fechar ✕
        </a>
      </div>

      <div className="divide-y divide-[var(--gridline)]">
        {itens.map((item) => (
          <div key={item.cod} className="p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-[var(--text-primary)]">
                {item.cor ? `${item.cor} · ` : ""}
                {item.tamanho ?? "—"}
                <span className="ml-2 font-normal text-[var(--text-muted)]">({item.cod})</span>
                {item.tipoCompra && (
                  <span className="ml-2 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--text-muted)]">
                    {item.tipoCompra}
                  </span>
                )}
              </div>
              <NivelBadge nivel={item.nivelAlerta} />
            </div>

            <div className="mb-3 overflow-x-auto rounded-md border border-[var(--gridline)]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] text-left text-[var(--text-muted)]">
                    <th className="px-3 py-1.5 font-medium text-right">Mínimo</th>
                    <th className="px-3 py-1.5 font-medium text-right">Estoque consolidado</th>
                    <th className="px-3 py-1.5 font-medium text-right">Diferença</th>
                    <th className="px-3 py-1.5 font-medium text-right">% cobertura</th>
                    <th className="px-3 py-1.5 font-medium text-right">Dias até cruzar mínimo</th>
                    <th className="px-3 py-1.5 font-medium text-right">Tempo médio de produção</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">
                      {item.minimoDefinido != null ? formatNumero(item.minimoDefinido) : "—"}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-right font-medium text-[var(--text-primary)]">
                      {formatNumero(item.estoqueConsolidado)}
                    </td>
                    <td
                      className="px-3 py-1.5 tabular-nums text-right"
                      style={{ color: item.diferenca != null && item.diferenca < 0 ? "var(--status-critical)" : undefined }}
                    >
                      {item.diferenca != null ? formatNumero(item.diferenca) : "—"}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">
                      {item.percentualCobertura != null ? `${item.percentualCobertura.toFixed(0)}%` : "—"}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">
                      {item.diasAteCruzarMinimo != null ? item.diasAteCruzarMinimo.toFixed(0) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right text-[var(--text-secondary)]">
                      {item.tempoMedioProducaoDias != null ? (
                        `${item.tempoMedioProducaoDias.toFixed(0)}d`
                      ) : (
                        <span className="text-[var(--text-muted)]" title="Sem ProductionOrder finalizada suficiente pra este cod">
                          sem dado suficiente pra prever reposição
                        </span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {podeEditar && (
              <div className="mb-3">
                <MinimoManualForm
                  cod={item.cod}
                  minimoDefinido={item.minimoDefinido}
                  velocidadeDiariaConsolidada={item.velocidadeDiariaConsolidada}
                />
              </div>
            )}

            <details>
              <summary className="cursor-pointer text-[11px] text-[var(--text-muted)] hover:underline">
                Onde está esse tamanho hoje (por loja/CD — só leitura, o mínimo nunca é avaliado por loja)
              </summary>
              <div className="mt-2 overflow-x-auto rounded-md border border-[var(--gridline)]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                      <th className="px-3 py-1.5 font-medium">Posição</th>
                      <th className="px-3 py-1.5 font-medium text-right">Estoque</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.porLoja.map((l) => (
                      <tr key={l.storeId} className="border-b border-[var(--gridline)] last:border-0">
                        <td className="px-3 py-1.5 text-[var(--text-secondary)]">{l.storeName}</td>
                        <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">{formatNumero(l.estoqueAtual)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
