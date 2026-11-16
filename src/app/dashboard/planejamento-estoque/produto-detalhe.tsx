import type { ProdutoPlanejamentoDetalhe } from "@/lib/metrics";
import { SalesTrendChart } from "../sales-trend-chart";
import { formatNumber } from "./format";

// "Não misturar cores de forma que distorça a curva de tamanhos" — por isso a tabela de tamanho
// é SEMPRE renderizada dentro do bloco de uma cor específica, nunca somada entre cores (ver
// getProdutoPlanejamentoDetalhe, src/lib/metrics/planejamento-estoque.ts).
export function ProdutoDetalhe({ detalhe, fecharHref }: { detalhe: ProdutoPlanejamentoDetalhe; fecharHref: string }) {
  const evolucao = detalhe.evolucaoVendas.map((d) => ({ day: d.day, unitsSold: d.unitsLiquida, revenue: d.revenueLiquida }));
  const temRecomendacao = detalhe.recomendacoesBestSeller.length > 0 || detalhe.recomendacoesDrop.length > 0;

  return (
    <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between border-b border-[var(--gridline)] px-4 py-2.5">
        <h2 className="text-sm font-medium text-[var(--text-secondary)]">
          Detalhe — {detalhe.produto} <span className="text-[var(--text-muted)]">({detalhe.cods.length} SKU(s))</span>
        </h2>
        <a href={fecharHref} className="text-xs text-[var(--text-muted)] hover:underline">
          Fechar ✕
        </a>
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Evolução de vendas (90 dias, líquida)</h3>
          <SalesTrendChart data={evolucao} showRevenue={false} />
        </div>

        <div>
          <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Estoque por loja/CD</h3>
          <div className="overflow-x-auto rounded-md border border-[var(--gridline)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                  <th className="px-3 py-1.5 font-medium">Posição</th>
                  <th className="px-3 py-1.5 font-medium text-right">Estoque</th>
                  <th className="px-3 py-1.5 font-medium text-right">Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {detalhe.porLoja.map((l) => (
                  <tr key={l.posicaoId} className="border-b border-[var(--gridline)] last:border-0">
                    <td className="px-3 py-1.5 text-[var(--text-secondary)]">{l.posicaoNome}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(l.estoqueAtual)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">
                      {l.coberturaDias != null ? `${l.coberturaDias.toFixed(0)}d` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--gridline)] p-4">
        <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">
          Distribuição por tamanho (por cor — nunca somada entre cores diferentes)
        </h3>
        <div className="flex flex-col gap-3">
          {detalhe.porCor.map((c) => (
            <div key={c.cor ?? "sem-cor"} className="overflow-x-auto rounded-md border border-[var(--gridline)]">
              <div className="border-b border-[var(--gridline)] bg-[var(--page-plane)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
                {c.cor ?? "Cor não informada"}
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                    <th className="px-3 py-1.5 font-medium">Tamanho</th>
                    <th className="px-3 py-1.5 font-medium text-right">Estoque total</th>
                    <th className="px-3 py-1.5 font-medium text-right">CD/Site</th>
                    <th className="px-3 py-1.5 font-medium text-right">Lojas</th>
                  </tr>
                </thead>
                <tbody>
                  {c.porTamanho.map((t) => (
                    <tr key={t.tamanho ?? "sem-tamanho"} className="border-b border-[var(--gridline)] last:border-0">
                      <td className="px-3 py-1.5 text-[var(--text-secondary)]">{t.tamanho ?? "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(t.estoqueTotal)}</td>
                      <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(t.estoqueCD)}</td>
                      <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(t.estoqueLojas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      {detalhe.quantidadeEmTransito > 0 && (
        <div className="border-t border-[var(--gridline)] px-4 py-3 text-xs text-[var(--text-secondary)]">
          <strong>{formatNumber(detalhe.quantidadeEmTransito)} unidade(s) em produção/trânsito</strong> — sem data de
          chegada confiável hoje (o DAPIC não informa previsão de finalização), por isso não está somada ao estoque
          disponível acima.
        </div>
      )}

      {temRecomendacao && (
        <div className="border-t border-[var(--gridline)] p-4">
          <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Recomendação do motor de compras (por SKU)</h3>
          <div className="flex flex-col gap-2 text-xs">
            {detalhe.recomendacoesBestSeller.map((r) => (
              <div key={r.cod} className="rounded-md border border-[var(--gridline)] p-2">
                <div className="font-medium text-[var(--text-primary)]">Best Seller · {r.cod}</div>
                <div className="text-[var(--text-secondary)]">
                  Sugestão: {formatNumber(r.quantidadeSugerida)} un. · Cobertura atual:{" "}
                  {r.coberturaAtualDias != null ? `${r.coberturaAtualDias.toFixed(0)}d` : "—"} ·{" "}
                  {r.confiavel ? "confiável" : "baixa confiança"}
                </div>
                {r.premissas.length > 0 && <div className="mt-1 text-[var(--text-muted)]">{r.premissas.join(" · ")}</div>}
              </div>
            ))}
            {detalhe.recomendacoesDrop.map((r) => (
              <div key={r.cod} className="rounded-md border border-[var(--gridline)] p-2">
                <div className="font-medium text-[var(--text-primary)]">Drop · {r.cod}</div>
                <div className="text-[var(--text-secondary)]">
                  {r.diasRestantesJanela > 0 ? `${r.diasRestantesJanela} dia(s) restantes na janela · ` : ""}
                  {r.riscoRuptura && "risco de ruptura"}
                  {r.riscoRuptura && r.riscoSobra && " · "}
                  {r.riscoSobra && "risco de sobra"}
                  {!r.riscoRuptura && !r.riscoSobra && "sem risco identificado"}
                </div>
                {r.premissas.length > 0 && <div className="mt-1 text-[var(--text-muted)]">{r.premissas.join(" · ")}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
