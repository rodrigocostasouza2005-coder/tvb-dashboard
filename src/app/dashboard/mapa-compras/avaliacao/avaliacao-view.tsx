import type { AvaliacaoDecisaoCompra } from "@/lib/metrics";
import { TipoCompraProduto } from "@prisma/client";
import { StatTile } from "../../stat-tile";
import { formatNumero } from "../inteligencia/format";
import { SITUACAO_LABEL, SITUACAO_COR } from "../../planejamento-estoque/format";
import { AVALIABILIDADE_LABEL, AVALIABILIDADE_COR, formatDataCurta } from "./format";

// Fase 2B do Planejamento Inteligente de Estoque (pedido do Rodrigo, 2026-11-16): avaliação
// retrospectiva de decisão de compra — compara o que foi recomendado/aprovado (DecisaoCompra)
// contra o que realmente aconteceu depois. Cálculo on-demand (src/lib/metrics/planejamento-
// avaliacao.ts), zero schema novo, zero persistência nova — só leitura e comparação.
//
// Regra visual inegociável: SEM_DADOS e PARCIAL nunca podem parecer COMPLETA. Nenhuma célula
// numérica aparece sem o rótulo de avaliabilidade visível na mesma linha, e todo número ausente
// mostra "—" (nunca 0, que seria lido como "zero vendas/zero estoque confirmado").
export function AvaliacaoDecisoesView({ avaliacoes }: { avaliacoes: AvaliacaoDecisaoCompra[] }) {
  if (avaliacoes.length === 0) {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        Nenhuma decisão de compra registrada ainda. Decisões aparecem aqui depois de confirmadas em
        &quot;Priorização&quot; acima (botão &quot;Aprovar&quot;) — sem decisão registrada, não há
        nada pra avaliar.
      </p>
    );
  }

  const porAvaliabilidade = {
    SEM_DADOS: avaliacoes.filter((a) => a.avaliabilidade === "SEM_DADOS").length,
    PARCIAL: avaliacoes.filter((a) => a.avaliabilidade === "PARCIAL").length,
    COMPLETA: avaliacoes.filter((a) => a.avaliabilidade === "COMPLETA").length,
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-muted)]">
        Compara a quantidade recomendada/aprovada em cada decisão contra venda e estoque reais
        depois dela. <strong>Sem dado suficiente</strong> = nada cruzável encontrado (decisão nova,
        só por grupo sem venda/estoque no grupo, ou cod sem histórico). <strong>Parcial</strong> =
        já há algum dado, mas o período pós-decisão ainda não completou 90 dias, ou a decisão só
        tem grupo (nunca chega a Completa nesse caso). <strong>Completa</strong> = cod presente,
        90 dias cheios decorridos, diagnóstico de ruptura/excesso calculado com a mesma régua do
        resto do Radar.
      </p>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Sem dado suficiente" value={String(porAvaliabilidade.SEM_DADOS)} />
        <StatTile label="Parcial" value={String(porAvaliabilidade.PARCIAL)} status={porAvaliabilidade.PARCIAL > 0 ? "warning" : undefined} />
        <StatTile label="Completa" value={String(porAvaliabilidade.COMPLETA)} status={porAvaliabilidade.COMPLETA > 0 ? "good" : undefined} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <table className="w-full min-w-[980px] border-collapse text-xs">
          <thead>
            <tr>
              <th className="border-b border-[var(--border)] px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Decidido em</th>
              <th className="border-b border-[var(--border)] px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Grupo / Cod</th>
              <th className="border-b border-[var(--border)] px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Tipo</th>
              <th className="border-b border-[var(--border)] px-3 py-2 text-right font-medium text-[var(--text-secondary)]">Recomendada</th>
              <th className="border-b border-[var(--border)] px-3 py-2 text-right font-medium text-[var(--text-secondary)]">Comprada</th>
              <th className="border-b border-[var(--border)] px-3 py-2 text-right font-medium text-[var(--text-secondary)]">Diferença</th>
              <th className="border-b border-[var(--border)] px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Avaliabilidade</th>
              <th className="border-b border-[var(--border)] px-3 py-2 text-right font-medium text-[var(--text-secondary)]">Vendas pós (30/60/90d)</th>
              <th className="border-b border-[var(--border)] px-3 py-2 text-right font-medium text-[var(--text-secondary)]">Estoque hoje</th>
              <th className="border-b border-[var(--border)] px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Diagnóstico pós-decisão</th>
            </tr>
          </thead>
          <tbody>
            {avaliacoes.map((a) => (
              <tr key={a.decisaoId} className="hover:bg-[var(--page-plane)]" title={a.avisos.join(" ")}>
                <td className="border-b border-[var(--gridline)] px-3 py-2 whitespace-nowrap">
                  {formatDataCurta(a.decididoEm)}
                  <div className="text-[10px] text-[var(--text-muted)]">{a.diasDecorridos}d atrás</div>
                </td>
                <td className="border-b border-[var(--gridline)] px-3 py-2">
                  <div>{a.grupo}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">{a.cod ?? "— só grupo —"}</div>
                </td>
                <td className="border-b border-[var(--gridline)] px-3 py-2">
                  {a.tipoCompra === TipoCompraProduto.BEST_SELLER ? "Best Seller" : "Drop"}
                </td>
                <td className="border-b border-[var(--gridline)] px-3 py-2 text-right tabular-nums">{formatNumero(a.quantidadeRecomendada)}</td>
                <td className="border-b border-[var(--gridline)] px-3 py-2 text-right tabular-nums">{formatNumero(a.quantidadeComprada)}</td>
                <td
                  className="border-b border-[var(--gridline)] px-3 py-2 text-right tabular-nums"
                  style={{ color: a.diferenca === 0 ? undefined : a.diferenca > 0 ? "var(--status-good)" : "var(--status-warning)" }}
                >
                  {a.diferenca > 0 ? "+" : ""}
                  {formatNumero(a.diferenca)}
                </td>
                <td className="border-b border-[var(--gridline)] px-3 py-2">
                  <span className={AVALIABILIDADE_COR[a.avaliabilidade]}>{AVALIABILIDADE_LABEL[a.avaliabilidade]}</span>
                  {a.baseCalculo === "grupo" && <div className="text-[10px] text-[var(--text-muted)]">aproximado por grupo</div>}
                </td>
                <td className="border-b border-[var(--gridline)] px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                  {formatNumero(a.vendasPosDecisao30)} / {formatNumero(a.vendasPosDecisao60)} / {formatNumero(a.vendasPosDecisao90)}
                </td>
                <td className="border-b border-[var(--gridline)] px-3 py-2 text-right tabular-nums">{formatNumero(a.estoqueAtual)}</td>
                <td className="border-b border-[var(--gridline)] px-3 py-2">
                  {a.diagnosticoPosDecisao ? (
                    <span className={SITUACAO_COR[a.diagnosticoPosDecisao]}>{SITUACAO_LABEL[a.diagnosticoPosDecisao]}</span>
                  ) : (
                    <span className="text-[var(--text-muted)]">Não calculado ({AVALIABILIDADE_LABEL[a.avaliabilidade].toLowerCase()})</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
