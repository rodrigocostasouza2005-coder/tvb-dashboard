import type { RecomendacaoGradeProduto } from "@/lib/metrics";
import { formatNumber } from "./format";

// Dá tela à grade por cor/tamanho (`getRecomendacaoGradeProduto`, src/lib/metrics/planejamento-grade.ts)
// — função já pronta e testada desde a Fase 2A (§10.4/§10.5 de
// docs/planejamento-inteligente-estoque.md), reaproveitada aqui sem recalcular nada. Mesmo padrão
// de arquitetura de ExcessoDistribuicaoSection (excesso-distribuicao.tsx): componente próprio, só
// leitura, renderizado condicionalmente dentro do painel de detalhe já existente — NUNCA uma aba
// nova (pedido explícito do Rodrigo).
//
// Duas seções, propositalmente separadas:
// 1) "Quantidade recomendada" (grade.porCor) — só aparece quando há de fato uma quantidade a
//    repartir (quantidadeSugeridaTotal > 0). Hoje é o caso raro (quase nenhum cod classificado em
//    produção tem quantidadeSugerida > 0 — ver §10.7/§14.4 do documento).
// 2) "Proporção observada" (grade.proporcaoObservada) — SEMPRE mostrada quando há venda real,
//    independente de haver quantidade a repartir. É o ajuste aditivo desta rodada: mesmo sem
//    sugestão de compra ativa, o Rodrigo quer ver "vende mais em X, menos em Y" como fato
//    descritivo, nunca uma recomendação fabricada.
export function GradeRecomendadaSection({ grade }: { grade: RecomendacaoGradeProduto }) {
  const temQuantidade = grade.quantidadeSugeridaTotal > 0 && grade.porCor.length > 0;
  const temProporcao = grade.proporcaoObservada.length > 0;
  if (!temQuantidade && !temProporcao) return null;

  return (
    <div className="border-t border-[var(--gridline)] p-4">
      <h3 className="mb-1 text-xs font-medium text-[var(--text-muted)]">
        Grade por tamanho (por cor — nunca misturando cores)
      </h3>
      <p className="mb-3 text-[11px] text-[var(--text-muted)]">
        Tamanhos vêm da venda REAL deste produto (nunca uma grade universal 38/40/42/44) — só os tamanhos que de fato
        venderam aparecem abaixo.
      </p>

      {temQuantidade && (
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between">
            <h4 className="text-xs font-medium text-[var(--text-secondary)]">
              Quantidade recomendada — {formatNumber(grade.quantidadeSugeridaTotal)} un. no total
            </h4>
          </div>
          <p className="mb-2 text-[11px] text-[var(--text-muted)]">
            Quantidade total vem do motor de compras já existente (por SKU, agregada aqui); a distribuição por cor e
            tamanho abaixo é proporcional à venda real de cada cor/tamanho.{" "}
            {!grade.confiavel && "Confiança baixa — revisar antes de aprovar."}
          </p>
          <div className="flex flex-col gap-3">
            {grade.porCor.map((c) => (
              <div key={c.cor ?? "sem-cor"} className="overflow-x-auto rounded-md border border-[var(--gridline)]">
                <div className="flex items-center justify-between border-b border-[var(--gridline)] bg-[var(--page-plane)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
                  <span>{c.cor ?? "Cor não informada"}</span>
                  <span className="tabular-nums">
                    {formatNumber(c.quantidadeSugerida)} un. ({c.participacaoPct.toFixed(0)}%)
                  </span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                      <th className="px-3 py-1.5 font-medium">Tamanho</th>
                      <th className="px-3 py-1.5 font-medium text-right">Quantidade sugerida</th>
                      <th className="px-3 py-1.5 font-medium text-right">Participação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.porTamanho.map((t) => (
                      <tr key={t.chave} className="border-b border-[var(--gridline)] last:border-0">
                        <td className="px-3 py-1.5 text-[var(--text-secondary)]">{t.chave}</td>
                        <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">
                          {formatNumber(t.quantidadeSugerida)}
                        </td>
                        <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">
                          {t.participacaoPct.toFixed(0)}%{!t.baseadoEmHistoricoReal && " (sem venda — peso padrão)"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      {temProporcao && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-[var(--text-secondary)]">Proporção observada de venda</h4>
          <p className="mb-2 text-[11px] text-[var(--text-muted)]">
            {temQuantidade
              ? "Mesma venda real usada acima pra repartir a compra, aqui só como leitura — quais tamanhos vendem mais por cor."
              : "O motor de compras ainda não sugeriu uma quantidade positiva pra este produto — mostrado abaixo mesmo assim, como fato descritivo: quais tamanhos vendem mais (ou menos) por cor, sem nenhuma recomendação de compra associada."}
          </p>
          <div className="flex flex-col gap-3">
            {grade.proporcaoObservada.map((c) => (
              <div key={c.cor ?? "sem-cor"} className="overflow-x-auto rounded-md border border-[var(--gridline)]">
                <div className="flex items-center justify-between border-b border-[var(--gridline)] bg-[var(--page-plane)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
                  <span>{c.cor ?? "Cor não informada"}</span>
                  <span className="tabular-nums">
                    {formatNumber(c.vendido)} vendido(s) ({c.participacaoPct.toFixed(0)}%)
                  </span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                      <th className="px-3 py-1.5 font-medium">Tamanho</th>
                      <th className="px-3 py-1.5 font-medium text-right">Vendido</th>
                      <th className="px-3 py-1.5 font-medium text-right">Participação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.porTamanho.map((t) => (
                      <tr key={t.chave} className="border-b border-[var(--gridline)] last:border-0">
                        <td className="px-3 py-1.5 text-[var(--text-secondary)]">{t.chave}</td>
                        <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(t.vendido)}</td>
                        <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">{t.participacaoPct.toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      {!grade.confiavel && grade.quantidadeSugeridaTotal <= 0 && (
        <p className="mt-3 text-[11px] text-[var(--text-muted)]">
          Confiança baixa na sugestão de compra deste produto (ver recomendação do motor de compras abaixo).
        </p>
      )}
    </div>
  );
}
