import type { HistoricoMovimentacoes } from "@/lib/metrics";
import { tipoMovimentacaoLabel } from "@/lib/metrics";
import { formatNumero, statusHistoricoInfo } from "./format";
import { atualizarStatusMovimentacaoAction } from "./actions";

// Aba 4 — Histórico/Acompanhamento. Mostra o ciclo de cada recomendação sobre a qual alguém já
// decidiu algo: gerada → pendente → aprovada → executada / recusada. O Radar NUNCA executa a
// movimentação física; "Executada" é a confirmação humana de que a peça foi movida de fato.
function dataBR(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function HistoricoMovimentacoesView({
  historico,
  podeDecidir,
}: {
  historico: HistoricoMovimentacoes;
  podeDecidir: boolean;
}) {
  if (historico.migrationPendente) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-6 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h2 className="mb-1 font-medium text-[var(--text-primary)]">Histórico ainda não disponível neste ambiente</h2>
        {/* break-words: o nome da migration é um token longo sem espaço — sem isso ele empurrava o
            body inteiro pra fora da tela no celular (achado no Playwright a 390px). */}
        <p className="break-words text-[var(--text-secondary)]">
          A tabela <code>DecisaoMovimentacaoEstoque</code> (modelo novo desta entrega) depende da migration{" "}
          <code>20261111160000_add_decisao_movimentacao_estoque</code>, que foi <strong>gerada mas não aplicada</strong>{" "}
          — por decisão desta entrega, nenhuma migration foi rodada contra o banco real. Depois de aplicar a migration,
          esta aba passa a listar o ciclo completo de cada recomendação (gerada → pendente → aprovada → executada →
          recusada) sem nenhuma mudança de código.
        </p>
      </div>
    );
  }

  if (historico.itens.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-6 text-center text-sm text-[var(--text-muted)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        Nenhuma decisão registrada ainda. Abra uma linha na aba Movimentações e use Aprovar / Recusar / Deixar pendente
        pra começar o acompanhamento.
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gridline)] px-4 py-2.5">
        <h2 className="text-sm font-medium text-[var(--text-secondary)]">
          Acompanhamento de decisões ({formatNumero(historico.itens.length)})
        </h2>
        <span className="text-xs text-[var(--text-muted)]">Mais recentes primeiro</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] text-left text-[var(--text-muted)]">
              <th className="px-3 py-1.5 font-medium whitespace-nowrap">Produto</th>
              <th className="px-3 py-1.5 font-medium whitespace-nowrap">Origem → Destino</th>
              <th className="px-3 py-1.5 font-medium whitespace-nowrap">Tipo</th>
              <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Sugerida</th>
              <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Aprovada</th>
              <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Executada</th>
              <th className="px-3 py-1.5 font-medium whitespace-nowrap">Status</th>
              <th className="px-3 py-1.5 font-medium whitespace-nowrap">Recomendada</th>
              <th className="px-3 py-1.5 font-medium whitespace-nowrap">Responsável</th>
              {podeDecidir && <th className="px-3 py-1.5 font-medium whitespace-nowrap">Atualizar</th>}
            </tr>
          </thead>
          <tbody>
            {historico.itens.map((h) => {
              const st = statusHistoricoInfo(h.status);
              return (
                <tr key={h.id} className="border-b border-[var(--gridline)] last:border-0">
                  <td className="px-3 py-1.5 text-[var(--text-primary)]">
                    {h.produto}
                    <span className="text-[var(--text-muted)]">
                      {h.cor ? ` · ${h.cor}` : ""}
                      {h.tamanho ? ` · ${h.tamanho}` : ""} ({h.cod})
                    </span>
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-secondary)]">
                    {h.origemNome} → {h.destinoNome}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-secondary)]">
                    {tipoMovimentacaoLabel(h.tipoMovimentacao)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">
                    {formatNumero(h.quantidadeSugerida)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">
                    {formatNumero(h.quantidadeAprovada)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">
                    {formatNumero(h.quantidadeExecutada)}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{ backgroundColor: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}
                    >
                      {st.label}
                    </span>
                    {h.confianca !== "alta" && (
                      <span className="ml-1 text-[10px] text-[var(--text-muted)]">({h.confianca})</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-muted)]">
                    {dataBR(h.recomendadoEm)}
                    {h.executadoEm ? ` · exec. ${dataBR(h.executadoEm)}` : h.decididoEm ? ` · dec. ${dataBR(h.decididoEm)}` : ""}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-muted)]">
                    {h.executadoPor ?? h.decididoPor ?? "—"}
                  </td>
                  {podeDecidir && (
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <form action={atualizarStatusMovimentacaoAction} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={h.id} />
                        <input
                          type="number"
                          name="quantidade"
                          min={0}
                          defaultValue={h.quantidadeAprovada ?? h.quantidadeSugerida}
                          className="w-14 rounded border border-[var(--border)] bg-[var(--surface-1)] px-1 py-0.5 text-[11px] tabular-nums"
                          aria-label="Quantidade"
                        />
                        <select
                          name="status"
                          defaultValue={h.status}
                          className="rounded border border-[var(--border)] bg-[var(--surface-1)] px-1 py-0.5 text-[11px]"
                          aria-label="Novo status"
                        >
                          <option value="PENDENTE">Pendente</option>
                          <option value="APROVADA">Aprovada</option>
                          <option value="EXECUTADA">Executada</option>
                          <option value="RECUSADA">Recusada</option>
                        </select>
                        <button
                          type="submit"
                          className="rounded border border-[var(--border)] bg-[var(--surface-1)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
                        >
                          Salvar
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
