import type { VisaoConsolidadaCompras } from "@/lib/metrics";
import { StatTile } from "../../stat-tile";
import { BarCompare } from "../../bar-compare";
import { formatMoeda, formatNumero } from "./format";
import { OrcamentoTotalForm, ConfirmarDecisaoForm } from "./forms";
import { TipoCompraProduto } from "@prisma/client";

// Visão consolidada (seção 7 do pedido): KPIs de verba (total planejada, sugerida BS, sugerida
// Drop), distribuição por grupo (gráfico, reaproveitando BarCompare) e prévia da priorização
// quando o orçamento não cobre tudo — a tabela completa por grupo mora no modo "Por grupo"
// (ModoToggle), pra esta tela ficar um resumo de decisão, não outra tabela densa.
export function ConsolidadoView({ visao, canEdit }: { visao: VisaoConsolidadaCompras; canEdit: boolean }) {
  const naoAtendidos = visao.itensPriorizados.filter((i) => !i.atendido);
  const topGrupos = visao.porGrupo.slice(0, 10).map((g) => ({
    label: g.grupo,
    a: g.bestSeller.valorEstimado,
    b: g.drop.valorEstimado,
  }));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--series-1)] bg-[var(--surface-1)] p-3">
        <OrcamentoTotalForm valorAtual={visao.orcamentoTotalPlanejado} canEdit={canEdit} />
      </div>

      {visao.planejamentoFinanceiroIncompleto && (
        <p className="rounded-md border border-[var(--gridline)] p-2 text-xs" style={{ color: "var(--status-warning)" }}>
          Planejamento financeiro incompleto:{" "}
          {visao.orcamentoTotalPlanejado == null ? "orçamento total não definido (a lista abaixo só ordena prioridades)" : null}
          {visao.orcamentoTotalPlanejado == null && visao.necessidadesSemCusto.length > 0 ? "; " : null}
          {visao.necessidadesSemCusto.length > 0
            ? `${visao.necessidadesSemCusto.length} necessidade(s) de compra sem custo unitário confiável (${formatNumero(visao.necessidadesSemCusto.reduce((s, n) => s + n.quantidadeSugerida, 0))} un) ficam fora da verba — ver Alertas`
            : null}
          .
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Verba sugerida total" value={formatMoeda(visao.verbaSugeridaTotal)} />
        <StatTile label="Verba sugerida — Best Seller" value={formatMoeda(visao.verbaSugeridaBestSeller)} />
        <StatTile label="Verba sugerida — Drop" value={formatMoeda(visao.verbaSugeridaDrop)} />
        <StatTile label="Quantidade total sugerida" value={formatNumero(visao.quantidadeTotalSugerida)} />
        {visao.orcamentoTotalPlanejado != null && (
          <>
            <StatTile label="Cabe no orçamento" value={formatMoeda(visao.valorAtendidoNoOrcamento)} status="good" />
            <StatTile
              label="Fora do orçamento"
              value={formatMoeda(visao.valorForaDoOrcamento)}
              status={visao.valorForaDoOrcamento > 0 ? "critical" : undefined}
            />
          </>
        )}
        <StatTile
          label="Horizonte"
          value={visao.horizonteDias == null ? "Meta por grupo" : `${visao.horizonteDias} dias`}
          subValue={visao.horizonteDias == null ? "cobertura cadastrada em cada grupo (padrão 30 dias)" : "simulação — nada é gravado"}
        />
      </div>

      {visao.produtosFilaRevisaoCount > 0 && (
        <StatTile
          label="Produtos pendentes de classificação"
          value={String(visao.produtosFilaRevisaoCount)}
          subValue="Veja em Alertas e prioridades — nunca tratados como Best Seller ou Drop até serem classificados"
          status="warning"
        />
      )}

      <div>
        <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">Verba sugerida por grupo (Best Seller vs. Drop)</h3>
        <BarCompare rows={topGrupos} labelA="Best Seller" labelB="Drop" colorA="var(--series-1)" colorB="var(--series-2)" />
      </div>

      {naoAtendidos.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
          <h3 className="mb-2 text-sm font-medium" style={{ color: "var(--status-critical)" }}>
            Orçamento insuficiente para {naoAtendidos.length} item(ns) priorizado(s) abaixo de outros
          </h3>
          <ul className="space-y-2">
            {naoAtendidos.slice(0, 10).map((item) => (
              <li key={item.id} className="rounded-md border border-[var(--gridline)] p-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong>{item.rotulo ?? item.grupo}</strong> ({item.grupo}) — {item.tipoCompra === TipoCompraProduto.BEST_SELLER ? "Best Seller" : "Drop"} · {formatNumero(item.quantidadeSugerida)} un · {formatMoeda(item.valorEstimado)}
                  </span>
                  <span className="text-[var(--text-muted)]">{item.motivoNaoAtendido}</span>
                </div>
                <ul className="mt-1 list-disc pl-4 text-[10px] text-[var(--text-muted)]">
                  {item.fatoresPrioridade.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">Priorização (ordem de atendimento do orçamento)</h3>
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
          <table className="w-full min-w-[700px] border-collapse text-xs">
            <thead>
              <tr>
                <th className="border-b border-[var(--border)] px-3 py-2 text-left font-medium text-[var(--text-secondary)]">#</th>
                <th className="border-b border-[var(--border)] px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Produto · grupo</th>
                <th className="border-b border-[var(--border)] px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Tipo</th>
                <th className="border-b border-[var(--border)] px-3 py-2 text-right font-medium text-[var(--text-secondary)]">Valor</th>
                <th className="border-b border-[var(--border)] px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Status</th>
                <th className="border-b border-[var(--border)] px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Confirmar</th>
              </tr>
            </thead>
            <tbody>
              {visao.itensPriorizados.map((item) => (
                <tr key={item.id} className="hover:bg-[var(--page-plane)]">
                  <td className="border-b border-[var(--gridline)] px-3 py-2 tabular-nums text-[var(--text-muted)]">{item.prioridade}</td>
                  <td className="border-b border-[var(--gridline)] px-3 py-2">
                    <div>{item.rotulo ?? item.grupo}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">{item.grupo}</div>
                  </td>
                  <td className="border-b border-[var(--gridline)] px-3 py-2">{item.tipoCompra === TipoCompraProduto.BEST_SELLER ? "Best Seller" : "Drop"}</td>
                  <td className="border-b border-[var(--gridline)] px-3 py-2 text-right tabular-nums">{formatMoeda(item.valorEstimado)}</td>
                  <td className="border-b border-[var(--gridline)] px-3 py-2">
                    <span style={{ color: item.atendido ? "var(--status-good)" : "var(--status-critical)" }}>
                      {item.atendido ? "Atendido" : "Fora do orçamento"}
                    </span>
                  </td>
                  <td className="border-b border-[var(--gridline)] px-3 py-2">
                    {item.atendido && (
                      <ConfirmarDecisaoForm
                        cod={item.id.split(":")[1]}
                        grupo={item.grupo}
                        tipoCompra={item.tipoCompra}
                        quantidadeSugerida={item.quantidadeSugerida}
                        premissas={{ premissas: item.fatoresPrioridade, avisos: [] }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
