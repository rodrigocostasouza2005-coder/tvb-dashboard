import type { ProdutoPlanejamentoDetalhe, ProdutoExcessoDistribuicao, ItemMinimoManual } from "@/lib/metrics";
import { formatNumber } from "./format";
import { MinimoManualForm } from "../estoque-minimo-manual/forms";

// Aba 4 "Reposição e Compras" (Zona 3, pedido do Rodrigo): necessidade de reposição usando o que
// for confiável (estoque atual, histórico, velocidade, tendência, trânsito, estoque mínimo),
// quantidade sugerida, justificativa, premissas, risco de não comprar, risco de comprar demais, e
// alternativa de redistribuição — sempre ANTES de considerar comprar (nunca recomendar comprar
// quando redistribuição resolveria). Reaproveita 100% o motor já maduro
// (compras-inteligencia.ts/getRecomendacoesBestSeller/Drop, já filtrado em detalhe pelo produto) —
// nenhum cálculo novo, só apresentação mais completa (premissas E avisos, antes só premissas
// apareciam) e o cruzamento explícito com a aba Distribuição.
export function AbaReposicaoProduto({
  detalhe,
  excesso,
  minimoManual,
  podeEditarMinimo,
}: {
  detalhe: ProdutoPlanejamentoDetalhe;
  excesso: ProdutoExcessoDistribuicao | null;
  minimoManual: ItemMinimoManual[];
  podeEditarMinimo: boolean;
}) {
  const temRecomendacao = detalhe.recomendacoesBestSeller.length > 0 || detalhe.recomendacoesDrop.length > 0;
  const temExcessoDisponivel = (excesso?.excessoCD ?? 0) > 0 || (excesso?.excessoLojas ?? 0) > 0;
  const totalOportunidades = excesso?.oportunidades.reduce((s, o) => s + o.quantidadeSugerida, 0) ?? 0;

  return (
    <div className="flex flex-col gap-4 p-4">
      {(temExcessoDisponivel || totalOportunidades > 0) && (
        <p className="rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--status-good)", color: "var(--status-good)" }}>
          Antes de comprar: este produto já tem {formatNumber((excesso?.excessoCD ?? 0) + (excesso?.excessoLojas ?? 0))} unidade(s) em
          excesso disponível em outra posição
          {totalOportunidades > 0 ? ` (${formatNumber(totalOportunidades)} un. já com transferência sugerida)` : ""} — ver aba Distribuição
          antes de confirmar qualquer compra nova.
        </p>
      )}

      {detalhe.quantidadeEmTransito > 0 && (
        <div className="rounded-md border border-[var(--gridline)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          <strong>{formatNumber(detalhe.quantidadeEmTransito)} unidade(s) em produção/trânsito.</strong>{" "}
          {detalhe.transitoConfiavel
            ? "Data de recebimento confiável — já considerada nas recomendações abaixo quando aplicável."
            : "Sem data de chegada confiável (o DAPIC não informa previsão de finalização) — NÃO contada como disponível, só sinalizada; recomendações abaixo tratam isso como incerto, nunca como estoque garantido."}
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Recomendação do motor de compras (por SKU)</h3>
        {!temRecomendacao ? (
          <p className="rounded-md border border-[var(--gridline)] px-3 py-6 text-center text-xs text-[var(--text-muted)]">
            Nenhum SKU deste produto está classificado Best Seller/Drop — sem classificação, o motor de compras não
            calcula quantidade sugerida (ver aba Decisões e Ações pra classificar). Isto é exibido honestamente, não
            uma quantidade inventada.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {detalhe.recomendacoesBestSeller.map((r) => (
              <div key={r.cod} className="rounded-md border border-[var(--gridline)] p-3 text-xs">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-[var(--text-primary)]">Best Seller · {r.cod}</span>
                  <span className="text-[var(--text-secondary)]">
                    Sugestão: <strong>{formatNumber(r.quantidadeSugerida)} un.</strong>
                    {r.valorEstimado != null && ` (≈ R$ ${r.valorEstimado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })})`} ·{" "}
                    {r.confiavel ? "confiança alta" : "baixa confiança — revisar antes de aprovar"}
                  </span>
                </div>
                <div className="text-[var(--text-secondary)]">
                  Cobertura atual: {r.coberturaAtualDias != null ? `${r.coberturaAtualDias.toFixed(0)}d` : "—"} · Recebimentos
                  já utilizáveis no cálculo: {formatNumber(r.recebimentosUtilizaveis)} un.
                </div>
                {r.premissas.length > 0 && (
                  <div className="mt-1 text-[var(--text-muted)]">
                    <strong>Premissas:</strong> {r.premissas.join(" · ")}
                  </div>
                )}
                {r.avisos.length > 0 && (
                  <div className="mt-1" style={{ color: "var(--status-warning)" }}>
                    <strong>Risco/aviso:</strong> {r.avisos.join(" · ")}
                  </div>
                )}
              </div>
            ))}
            {detalhe.recomendacoesDrop.map((r) => (
              <div key={r.cod} className="rounded-md border border-[var(--gridline)] p-3 text-xs">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-[var(--text-primary)]">Drop · {r.cod}</span>
                  <span className="text-[var(--text-secondary)]">
                    {r.quantidadeSugerida != null
                      ? `Sugestão: ${formatNumber(r.quantidadeSugerida)} un.`
                      : r.precisaConfirmacaoHumana
                        ? "Aguardando confirmação humana"
                        : "Sem quantidade sugerida"}
                    {r.diasRestantesJanela > 0 && ` · ${r.diasRestantesJanela}d restantes de janela`}
                  </span>
                </div>
                <div className="flex flex-wrap gap-3 text-[var(--text-secondary)]">
                  <span style={{ color: r.riscoRuptura ? "var(--status-critical)" : undefined }}>
                    {r.riscoRuptura ? `Risco de ruptura (faltariam ${formatNumber(r.faltanteEstimado)} un.)` : "Sem risco de ruptura iminente"}
                  </span>
                  <span style={{ color: r.riscoSobra ? "var(--status-warning)" : undefined }}>
                    {r.riscoSobra ? `Risco de sobra (excedente estimado ${formatNumber(r.excedenteEstimado)} un.)` : "Sem risco de sobra identificado"}
                  </span>
                </div>
                {r.premissas.length > 0 && (
                  <div className="mt-1 text-[var(--text-muted)]">
                    <strong>Premissas:</strong> {r.premissas.join(" · ")}
                  </div>
                )}
                {r.avisos.length > 0 && (
                  <div className="mt-1" style={{ color: "var(--status-warning)" }}>
                    <strong>Risco/aviso:</strong> {r.avisos.join(" · ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Estoque mínimo manual por SKU (empresa toda)</h3>
        {minimoManual.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">Nenhum SKU deste produto tem estoque mínimo manual cadastrado.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[var(--gridline)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                  <th className="px-3 py-1.5 font-medium">SKU</th>
                  <th className="px-3 py-1.5 font-medium text-right">Disponível (empresa)</th>
                  <th className="px-3 py-1.5 font-medium text-right">Mínimo</th>
                  <th className="px-3 py-1.5 font-medium">Nível</th>
                  {podeEditarMinimo && <th className="px-3 py-1.5 font-medium">Ajustar</th>}
                </tr>
              </thead>
              <tbody>
                {minimoManual.map((m) => (
                  <tr key={m.cod} className="border-b border-[var(--gridline)] last:border-0">
                    <td className="px-3 py-1.5 text-[var(--text-secondary)]">
                      {m.cod}
                      {m.cor ? ` · ${m.cor}` : ""}
                      {m.tamanho ? ` · ${m.tamanho}` : ""}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(m.estoqueConsolidado)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">
                      {m.minimoDefinido != null ? formatNumber(m.minimoDefinido) : "sem mínimo"}
                    </td>
                    <td
                      className="px-3 py-1.5 font-medium"
                      style={{
                        color:
                          m.nivelAlerta === "CRITICO"
                            ? "var(--status-critical)"
                            : m.nivelAlerta === "ATENCAO"
                              ? "var(--status-warning)"
                              : m.nivelAlerta === "NORMAL"
                                ? "var(--status-good)"
                                : "var(--text-muted)",
                      }}
                    >
                      {m.nivelAlerta === "SEM_MINIMO_DEFINIDO" ? "Sem mínimo definido" : m.nivelAlerta}
                    </td>
                    {podeEditarMinimo && (
                      <td className="px-3 py-1.5">
                        <MinimoManualForm cod={m.cod} minimoDefinido={m.minimoDefinido} velocidadeDiariaConsolidada={m.velocidadeDiariaConsolidada} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
