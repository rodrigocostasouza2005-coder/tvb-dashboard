import type { VisaoGeralDistribuicao } from "@/lib/metrics";
import { StatTile } from "../stat-tile";
import { formatNumero, situacaoInfo } from "./format";

// Aba 1 — Visão Geral. Tabela densa por unidade (agora com CD/Site e todas as lojas de varejo
// reais) em vez de um card por loja: com 4+ unidades, card por unidade já não cabe na tela do
// celular e obriga a rolar pra comparar dois números que deveriam estar lado a lado.
export function VisaoGeralDistribuicaoView({ visao }: { visao: VisaoGeralDistribuicao }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Estoque total nas unidades" value={formatNumero(visao.estoqueTotal)} subValue="unidades em posição comercial" />
        <StatTile
          label="Excesso identificado"
          value={formatNumero(visao.excessoUnidades)}
          subValue="un. acima da cobertura-alvo"
          status={visao.excessoUnidades > 0 ? "warning" : "good"}
        />
        <StatTile
          label="Produtos com grade incompleta"
          value={formatNumero(visao.produtosGradeIncompleta)}
          subValue="falta tamanho que a unidade vende"
          status={visao.produtosGradeIncompleta > 0 ? "warning" : "good"}
        />
        <StatTile
          label="Oportunidades de redistribuição"
          value={formatNumero(visao.oportunidadesRedistribuicao)}
          subValue={`+ ${formatNumero(visao.recolhimentos)} recolhimento(s) p/ CD-Site`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Peças potencialmente movimentáveis" value={formatNumero(visao.pecasMovimentaveis)} subValue="soma das quantidades sugeridas" />
        <StatTile
          label="Alertas de estoque parado"
          value={formatNumero(visao.alertasEstoqueParado)}
          subValue="variante×unidade sem venda em 90d"
          status={visao.alertasEstoqueParado > 0 ? "warning" : "good"}
        />
        <StatTile label="Recomendações MANTER" value={formatNumero(visao.manterCount)} subValue="aparente excesso com motivo pra não mover" />
        <StatTile
          label="Baixa confiança"
          value={formatNumero(visao.baixaConfianca)}
          subValue="dependem de validação humana"
          status={visao.baixaConfianca > 0 ? "warning" : "good"}
        />
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gridline)] px-4 py-2.5">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">Quadro comparativo por unidade</h2>
          <span className="text-xs text-[var(--text-muted)]">
            {formatNumero(visao.variantesAnalisadas)} variantes analisadas · {formatNumero(visao.semDadoSuficiente)} sem dado suficiente
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] text-left text-[var(--text-muted)]">
                <th className="px-3 py-1.5 font-medium whitespace-nowrap">Unidade</th>
                <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Estoque</th>
                <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">SKUs c/ estoque</th>
                <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Excesso (un.)</th>
                <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Necessidade (un.)</th>
                <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Precisa</th>
                <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Sobra</th>
                <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Parado</th>
                <th className="px-3 py-1.5 font-medium whitespace-nowrap">Situação</th>
              </tr>
            </thead>
            <tbody>
              {visao.porUnidade.map((u) => {
                const info = situacaoInfo(u.situacao);
                return (
                  <tr key={u.posicaoId} className="border-b border-[var(--gridline)] last:border-0">
                    <td className="px-3 py-1.5 whitespace-nowrap font-medium text-[var(--text-primary)]">
                      {u.posicaoNome}
                      {u.tipoPosicao === "cd_site" && (
                        <span className="ml-1.5 rounded px-1 py-0.5 text-[10px] font-normal text-[var(--text-muted)] ring-1 ring-[var(--gridline)]">
                          CD/Site
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">{formatNumero(u.estoqueTotal)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">{formatNumero(u.skusComEstoque)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">{formatNumero(u.excessoUnidades)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">{formatNumero(u.necessidadeUnidades)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: u.variantesPrecisa > 0 ? "var(--status-critical)" : undefined }}>
                      {formatNumero(u.variantesPrecisa)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: u.variantesSobra > 0 ? "var(--status-warning)" : undefined }}>
                      {formatNumero(u.variantesSobra)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: u.variantesParadas > 0 ? "var(--status-warning)" : undefined }}>
                      {formatNumero(u.variantesParadas)}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: info.color }} />
                        {info.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {visao.porUnidade.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-4 text-center text-[var(--text-muted)]">
                    Nenhuma unidade comercial visível no filtro/permissão atual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {visao.unidadesIgnoradas.length > 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          Armazéns ignorados nesta análise (têm <code>sellsProducts=true</code> no cadastro, mas não são posição
          comercial):{" "}
          {visao.unidadesIgnoradas.map((u) => `${u.nome} (${u.motivo})`).join("; ")}.
        </p>
      )}
    </div>
  );
}
