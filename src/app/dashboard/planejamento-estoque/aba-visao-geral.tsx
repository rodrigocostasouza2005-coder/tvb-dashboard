import type { ProdutoPlanejamentoDetalhe, ProdutoPlanejamento } from "@/lib/metrics";
import type { RecomendacaoPrincipal } from "@/lib/metrics";
import { SalesTrendChart } from "../sales-trend-chart";
import { StatTile } from "../stat-tile";
import { formatNumber, SITUACAO_LABEL, SITUACAO_COR, TENDENCIA_LABEL } from "./format";

const RECOMENDACAO_COR: Record<RecomendacaoPrincipal["tipo"], string> = {
  comprar: "var(--series-1)",
  transferir: "var(--status-good)",
  aguardar: "var(--text-muted)",
  reduzir_exposicao: "var(--status-warning)",
  revisar_classificacao: "var(--status-warning)",
  sem_necessidade: "var(--status-good)",
  sem_dado_suficiente: "var(--text-muted)",
};

// Aba 1 "Visão Geral do produto" (Zona 3, pedido do Rodrigo): estoque total, por unidade, vendas
// recentes, velocidade, cobertura, dias de estoque, tendência, situação, alertas e a recomendação
// principal destacada COM justificativa — tudo num único olhar, sem scroll excessivo. Nunca
// confunde estoque total da empresa com disponibilidade numa unidade específica: a tabela "por
// loja/CD" abaixo é sempre rotulada por posição, nunca somada de volta num número único ali.
export function AbaVisaoGeralProduto({
  detalhe,
  linha,
  recomendacao,
}: {
  detalhe: ProdutoPlanejamentoDetalhe;
  linha: ProdutoPlanejamento | undefined;
  recomendacao: RecomendacaoPrincipal | null;
}) {
  const evolucao = detalhe.evolucaoVendas.map((d) => ({ day: d.day, unitsSold: d.unitsLiquida, revenue: d.revenueLiquida }));

  return (
    <div className="flex flex-col gap-4 p-4">
      {recomendacao && (
        <section
          className="rounded-lg border px-4 py-3"
          style={{ borderColor: RECOMENDACAO_COR[recomendacao.tipo], backgroundColor: `color-mix(in srgb, ${RECOMENDACAO_COR[recomendacao.tipo]} 6%, transparent)` }}
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: RECOMENDACAO_COR[recomendacao.tipo] }} />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{recomendacao.titulo}</h3>
          </div>
          <ul className="ml-4 list-disc space-y-0.5 text-xs text-[var(--text-secondary)]">
            {recomendacao.justificativa.map((linha, i) => (
              <li key={i}>{linha}</li>
            ))}
          </ul>
        </section>
      )}

      {linha && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Estoque total" value={formatNumber(linha.estoqueTotal)} subValue={`CD/Site ${formatNumber(linha.estoqueCD)} · Lojas ${formatNumber(linha.estoqueLojas)}`} />
          <StatTile
            label="Vendas 30/60/90d"
            value={`${formatNumber(linha.vendasDias30)}/${formatNumber(linha.vendasDias60)}/${formatNumber(linha.vendasDias90)}`}
            subValue={linha.confiavel ? `vel. ${linha.velocidadeDiaria.toFixed(2)}/dia` : "histórico insuficiente (<14d)"}
          />
          <StatTile
            label="Cobertura"
            value={linha.coberturaDias != null ? `${linha.coberturaDias.toFixed(0)}d` : "—"}
            subValue={TENDENCIA_LABEL[linha.tendencia]}
          />
          <StatTile
            label="Situação"
            value={SITUACAO_LABEL[linha.situacao]}
            subValue={linha.quantidadeEmTransito > 0 ? `${formatNumber(linha.quantidadeEmTransito)} un. em trânsito (não confirmado)` : undefined}
            status={
              linha.situacao === "ruptura" || linha.situacao === "cobertura_critica"
                ? "critical"
                : linha.situacao === "cobertura_excessiva" || linha.situacao === "estoque_parado"
                  ? "warning"
                  : linha.situacao === "equilibrado"
                    ? "good"
                    : undefined
            }
          />
        </section>
      )}

      {linha?.demandaPossivelmenteMascarada && (
        <p className="rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--status-warning)", color: "var(--status-warning)" }}>
          Estoque crítico/zerado em pelo menos uma posição — a venda observada pode estar subestimando a demanda real
          porque faltou produto pra vender, não necessariamente falta de interesse.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Evolução de vendas (90 dias, líquida)</h3>
          <SalesTrendChart data={evolucao} showRevenue={false} />
        </div>

        <div>
          <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Estoque e demanda por loja/CD</h3>
          <p className="mb-2 text-[11px] text-[var(--text-muted)]">
            Estoque total da empresa ({formatNumber(linha?.estoqueTotal ?? 0)} un.) nunca é o mesmo que a disponibilidade
            numa unidade específica — cada linha abaixo é a posição real daquela unidade. Venda do CD/Site já inclui o
            que ele abasteceu pras lojas (giro aparente daquela posição) — comparar entre lojas é seguro, mas não é
            &quot;venda total da empresa&quot;.
          </p>
          <div className="overflow-x-auto rounded-md border border-[var(--gridline)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                  <th className="px-3 py-1.5 font-medium">Posição</th>
                  <th className="px-3 py-1.5 font-medium text-right">Estoque</th>
                  <th className="px-3 py-1.5 font-medium text-right">Vendas 30d</th>
                  <th className="px-3 py-1.5 font-medium text-right">Cobertura</th>
                  <th className="px-3 py-1.5 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {detalhe.porLoja.map((l) => (
                  <tr key={l.posicaoId} className="border-b border-[var(--gridline)] last:border-0">
                    <td className="px-3 py-1.5 text-[var(--text-secondary)]">
                      {l.posicaoNome}
                      {l.tipoPosicao === "cd_site" && <span className="ml-1 text-[10px] text-[var(--text-muted)]">CD/Site</span>}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(l.estoqueAtual)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(l.vendasDias30)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">
                      {l.coberturaDias != null ? `${l.coberturaDias.toFixed(0)}d` : "—"}
                    </td>
                    <td className={`px-3 py-1.5 font-medium ${SITUACAO_COR[l.diagnostico]}`}>{SITUACAO_LABEL[l.diagnostico]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {detalhe.quantidadeEmTransito > 0 && (
        <p className="text-xs text-[var(--text-secondary)]">
          <strong>{formatNumber(detalhe.quantidadeEmTransito)} unidade(s) em produção/trânsito</strong> — sem data de
          chegada confiável hoje (o DAPIC não informa previsão de finalização), por isso não está somada ao estoque
          disponível acima. Ver aba Reposição e Compras para o detalhe.
        </p>
      )}
    </div>
  );
}
