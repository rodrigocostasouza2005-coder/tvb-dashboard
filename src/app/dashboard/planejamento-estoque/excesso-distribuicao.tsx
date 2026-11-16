import type { ProdutoExcessoDistribuicao, DecisoesMovimentacaoPorStatus } from "@/lib/metrics";
import { tipoMovimentacaoLabel } from "@/lib/metrics";
import { prioridadeInfo, confiancaInfo, statusHistoricoInfo, formatNumero } from "../distribuicao-estoque/format";

// Fase 2B — "gestão inteligente de excesso e distribuição" (docs/planejamento-inteligente-estoque.md
// §10.6). Decisão de arquitetura tomada aqui (documentada, precisa de validação do Rodrigo): em vez
// de criar uma 11ª aba isolada ou duplicar a tela de decisão (Aprovar/Recusar já existe e é
// server action real em distribuicao-estoque/actions.ts), esta seção é SÓ LEITURA — mostra o que o
// motor já maduro (distribuicao-estoque.ts) recomendou pra ESTE produto, com um link pra abrir a
// aba Movimentações da Distribuição de Estoque (já filtrada por este produto) pra quem for decidir
// de fato. Mostrada só quando o produto aberto tem classificação Best Seller/Drop E
// getProdutoExcessoDistribuicao encontrou algum sinal (excesso/ruptura/oportunidade) — ver
// page.tsx. Essa segunda condição (só Best Seller/Drop) é a parte que mais precisa de validação:
// pode fazer sentido mostrar pra MISTO/NAO_CLASSIFICADO também, já que o motor de distribuição não
// depende de classificação pra funcionar — ficou restrito por ser o que o briefing desta fase pediu
// literalmente ("quando o produto aberto tiver tipoCompra Best Seller/Drop").
export function ExcessoDistribuicaoSection({
  dados,
  decisoes,
  distribuicaoHref,
}: {
  dados: ProdutoExcessoDistribuicao;
  decisoes: DecisoesMovimentacaoPorStatus | null;
  distribuicaoHref: string;
}) {
  const temOportunidades = dados.oportunidades.length > 0;
  return (
    <div className="border-t border-[var(--gridline)] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-[var(--text-muted)]">Excesso e distribuição entre unidades</h3>
        <a href={distribuicaoHref} className="text-[11px] text-[var(--series-1)] hover:underline">
          Abrir na Distribuição de Estoque (decidir/aprovar) →
        </a>
      </div>
      <p className="mb-3 text-[11px] text-[var(--text-muted)]">
        Reaproveita o motor já em produção da Distribuição de Estoque — nenhum cálculo novo de alocação. &quot;Deve
        permanecer no CD&quot; é o mínimo cadastrado (StockMinimumRule) + margem de segurança (meia semana de giro);
        só a sobra acima disso entra como excesso disponível pra transferir.
      </p>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat label="Excesso no CD/Site" value={dados.excessoCD} destaque={dados.excessoCD > 0} />
        <MiniStat label="Deve permanecer no CD" value={dados.estoqueCDPermanece} />
        <MiniStat label="Excesso em loja" value={dados.excessoLojas} destaque={dados.excessoLojas > 0} />
        <MiniStat label="Lojas em ruptura/crítico" value={dados.rupturaLojas} destaque={dados.rupturaLojas > 0} critico={dados.rupturaLojas > 0} />
      </div>

      {dados.rupturaComExcessoDisponivel && (
        <p className="mb-3 rounded-md border px-3 py-2 text-[11px]" style={{ borderColor: "var(--status-warning)", color: "var(--status-warning)" }}>
          Há loja em risco de ruptura/cobertura crítica enquanto outra posição deste produto tem excesso disponível —
          veja as oportunidades de transferência abaixo antes de considerar compra nova.
        </p>
      )}

      {dados.dropsCicloAtivoProtegidos > 0 && (
        <p className="mb-3 text-[11px] text-[var(--text-muted)]">
          {dados.dropsCicloAtivoProtegidos} oportunidade(s) de transferência ocultada(s) nesta visão porque o SKU é
          Drop ainda em ciclo ativo com venda real nos últimos 90 dias — esvaziar um Drop vendendo normalmente não é
          excesso real, é só ainda não ter girado o suficiente. Consulte a aba Distribuição de Estoque pra ver a lista
          completa sem este filtro.
        </p>
      )}

      {temOportunidades ? (
        <div className="overflow-x-auto rounded-md border border-[var(--gridline)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] text-left text-[var(--text-muted)]">
                <th className="px-3 py-1.5 font-medium">SKU</th>
                <th className="px-3 py-1.5 font-medium">Direção</th>
                <th className="px-3 py-1.5 font-medium">Origem</th>
                <th className="px-3 py-1.5 font-medium">Destino</th>
                <th className="px-3 py-1.5 text-right font-medium">Qtd.</th>
                <th className="px-3 py-1.5 font-medium">Prioridade</th>
                <th className="px-3 py-1.5 font-medium">Confiança</th>
                <th className="px-3 py-1.5 font-medium">Justificativa</th>
              </tr>
            </thead>
            <tbody>
              {dados.oportunidades.map((m, i) => {
                const pri = prioridadeInfo(m.prioridade);
                const conf = confiancaInfo(m.confianca);
                return (
                  <tr key={`${m.cod}-${m.origemPosicaoId}-${m.destinoPosicaoId}-${i}`} className="border-b border-[var(--gridline)] last:border-0">
                    <td className="px-3 py-1.5 text-[var(--text-secondary)]">
                      {m.cod}
                      {m.cor ? ` · ${m.cor}` : ""}
                      {m.tamanho ? ` · ${m.tamanho}` : ""}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-muted)]">{tipoMovimentacaoLabel(m.tipoMovimentacao)}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-secondary)]">{m.origemNome}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-secondary)]">{m.destinoNome}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right font-medium text-[var(--text-primary)]">{formatNumero(m.quantidadeSugerida)}</td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: pri.color }} />
                        {pri.label}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <span style={{ color: conf.color }}>{conf.label}</span>
                    </td>
                    <td className="max-w-[20rem] px-3 py-1.5 text-[var(--text-muted)]">
                      <span className="line-clamp-2">{m.justificativa[0]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[11px] text-[var(--text-muted)]">
          Nenhuma oportunidade de transferência recomendada pra este produto no momento.
        </p>
      )}

      {decisoes && (decisoes.pendente.length > 0 || decisoes.aprovada.length > 0 || decisoes.executada.length > 0 || decisoes.recusada.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <span>Decisões já registradas pra este produto:</span>
          {(["pendente", "aprovada", "executada", "recusada"] as const).map((k) => {
            const n = decisoes[k].length;
            if (n === 0) return null;
            const info = statusHistoricoInfo(k.toUpperCase());
            return (
              <span key={k} className="inline-flex items-center gap-1">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: info.color }} />
                {info.label}: {n}
              </span>
            );
          })}
        </div>
      )}
      {decisoes?.migrationPendente && (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          Histórico de decisões indisponível neste ambiente (migration DecisaoMovimentacaoEstoque pendente).
        </p>
      )}
    </div>
  );
}

function MiniStat({ label, value, destaque, critico }: { label: string; value: number; destaque?: boolean; critico?: boolean }) {
  const cor = critico ? "var(--status-critical)" : destaque ? "var(--status-warning)" : "var(--text-primary)";
  return (
    <div className="rounded-md border border-[var(--gridline)] px-3 py-2">
      <div className="text-[10px] text-[var(--text-muted)]">{label}</div>
      <div className="text-sm font-semibold tabular-nums" style={{ color: cor }}>
        {formatNumero(value)}
      </div>
    </div>
  );
}
