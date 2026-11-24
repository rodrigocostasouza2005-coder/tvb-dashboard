import type { ProdutoPlanejamentoDetalhe, RecomendacaoGradeProduto } from "@/lib/metrics";
import { formatNumber } from "./format";

// Aba 2 "Grade" (Zona 3, pedido do Rodrigo) — RESOLVE a redundância real encontrada pela auditoria
// de Fase 1 (§5 item 4 / §1.2 bloco 4 vs. 6): antes, "Distribuição por tamanho" (estoque real, de
// detalhe.porCor) e "Proporção observada de venda" (venda real, de grade.proporcaoObservada) eram
// DUAS tabelas empilhadas, mesma decomposição cor→tamanho do mesmo produto, números diferentes
// (estoque vs. venda) e vocabulário diferente — risco real de um usuário não perceber que são dois
// recortes da mesma coisa. Aqui é UMA tabela por cor, com uma coluna pra cada fato (estoque atual,
// vendido, participação, sugestão de compra quando houver) — nenhum cálculo novo, só o JOIN de
// apresentação entre os dois resultados que os motores já maduros (planejamento-estoque.ts/
// planejamento-grade.ts) já calculam.
//
// Nunca distribui quantidade igualmente sem fundamento: a "Sugestão" vem de
// getRecomendacaoGradeProduto, que já decompõe proporcionalmente à venda REAL (ou ao núcleo de
// tamanho 38/40/42/44 só quando não há venda alguma — ver planejamento-grade.ts/pesoFallbackTamanho).
export function AbaGradeProduto({
  detalhe,
  grade,
}: {
  detalhe: ProdutoPlanejamentoDetalhe;
  grade: RecomendacaoGradeProduto | null;
}) {
  type LinhaTamanho = {
    tamanho: string;
    estoqueTotal: number;
    estoqueCD: number;
    estoqueLojas: number;
    vendido: number | null;
    participacaoVendaPct: number | null;
    quantidadeSugerida: number | null;
    participacaoSugeridaPct: number | null;
    baseadoEmHistoricoReal: boolean | null;
  };

  const proporcaoPorCor = new Map((grade?.proporcaoObservada ?? []).map((c) => [c.cor ?? "", c]));
  const sugestaoPorCor = new Map((grade?.porCor ?? []).map((c) => [c.cor ?? "", c]));

  const linhasPorCor = detalhe.porCor.map((corDetalhe) => {
    const corKey = corDetalhe.cor ?? "";
    const proporcao = proporcaoPorCor.get(corKey);
    const sugestao = sugestaoPorCor.get(corKey);
    const proporcaoPorTamanho = new Map((proporcao?.porTamanho ?? []).map((t) => [t.chave === "—" ? "" : t.chave, t]));
    const sugestaoPorTamanho = new Map((sugestao?.porTamanho ?? []).map((t) => [t.chave === "—" ? "" : t.chave, t]));

    const estoqueTotalCor = corDetalhe.porTamanho.reduce((s, t) => s + t.estoqueTotal, 0);

    const linhas: LinhaTamanho[] = corDetalhe.porTamanho.map((t) => {
      const tamKey = t.tamanho ?? "";
      const prop = proporcaoPorTamanho.get(tamKey);
      const sug = sugestaoPorTamanho.get(tamKey);
      return {
        tamanho: t.tamanho ?? "—",
        estoqueTotal: t.estoqueTotal,
        estoqueCD: t.estoqueCD,
        estoqueLojas: t.estoqueLojas,
        vendido: prop?.vendido ?? null,
        participacaoVendaPct: prop?.participacaoPct ?? null,
        quantidadeSugerida: sug?.quantidadeSugerida ?? null,
        participacaoSugeridaPct: sug?.participacaoPct ?? null,
        baseadoEmHistoricoReal: sug?.baseadoEmHistoricoReal ?? null,
      };
    });

    // Sinal pedido explicitamente pelo Rodrigo: "expor quando o produto tem estoque total
    // suficiente mas tamanhos relevantes esgotados" — tamanho com estoque zerado HOJE, mas a cor
    // como um todo tem estoque em outro tamanho E este tamanho específico já vendeu alguma vez
    // nesta janela (é "relevante", não um tamanho que nunca girou).
    const tamanhosEsgotados = linhas.filter((l) => l.estoqueTotal === 0 && estoqueTotalCor > 0 && (l.vendido ?? 0) > 0);

    return { cor: corDetalhe.cor, estoqueTotalCor, linhas, tamanhosEsgotados };
  });

  const temAlgumaSugestao = (grade?.quantidadeSugeridaTotal ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-xs text-[var(--text-muted)]">
        Quantidade atual por tamanho, venda e participação reais, e sugestão de reposição por tamanho (quando o motor
        de compras já sugeriu uma quantidade positiva pra este produto) — tudo numa única tabela por cor, nunca
        misturando cores diferentes do mesmo produto. Tamanhos vêm da venda/estoque REAL deste produto, nunca de uma
        grade universal fixa.
      </p>

      {grade?.confiavel === false && (
        <p className="rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--status-warning)", color: "var(--status-warning)" }}>
          Confiança baixa na sugestão de compra deste produto — revisar antes de aprovar (ver aba Reposição e Compras).
        </p>
      )}

      {linhasPorCor.length === 0 && (
        <p className="rounded-md border border-[var(--gridline)] px-3 py-6 text-center text-xs text-[var(--text-muted)]">
          Sem dado de estoque por cor/tamanho pra este produto no filtro atual.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {linhasPorCor.map(({ cor, linhas, tamanhosEsgotados }) => (
          <div key={cor ?? "sem-cor"} className="overflow-x-auto rounded-md border border-[var(--gridline)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gridline)] bg-[var(--page-plane)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)]">
              <span>{cor ?? "Cor não informada"}</span>
              {tamanhosEsgotados.length > 0 && (
                <span className="text-[11px] font-normal" style={{ color: "var(--status-warning)" }}>
                  {tamanhosEsgotados.length} tamanho(s) com histórico de venda e estoque zerado hoje — estoque total
                  da cor pode estar escondendo ruptura pontual de tamanho.
                </span>
              )}
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                  <th className="px-3 py-1.5 font-medium">Tamanho</th>
                  <th className="px-3 py-1.5 font-medium text-right">Estoque total</th>
                  <th className="px-3 py-1.5 font-medium text-right">CD/Site</th>
                  <th className="px-3 py-1.5 font-medium text-right">Lojas</th>
                  <th className="px-3 py-1.5 font-medium text-right">Vendido (venda real)</th>
                  <th className="px-3 py-1.5 font-medium text-right">Participação na venda</th>
                  {temAlgumaSugestao && <th className="px-3 py-1.5 font-medium text-right">Sugestão de reposição</th>}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const esgotado = l.estoqueTotal === 0 && (l.vendido ?? 0) > 0;
                  return (
                    <tr key={l.tamanho} className="border-b border-[var(--gridline)] last:border-0">
                      <td className="px-3 py-1.5 text-[var(--text-secondary)]">{l.tamanho}</td>
                      <td
                        className="px-3 py-1.5 tabular-nums text-right"
                        style={{ color: esgotado ? "var(--status-warning)" : undefined }}
                      >
                        {formatNumber(l.estoqueTotal)}
                        {esgotado && " (esgotado)"}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(l.estoqueCD)}</td>
                      <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(l.estoqueLojas)}</td>
                      <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">
                        {l.vendido != null ? formatNumber(l.vendido) : "—"}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">
                        {l.participacaoVendaPct != null ? `${l.participacaoVendaPct.toFixed(0)}%` : "—"}
                      </td>
                      {temAlgumaSugestao && (
                        <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-primary)]">
                          {l.quantidadeSugerida != null ? (
                            <>
                              {formatNumber(l.quantidadeSugerida)}
                              {l.baseadoEmHistoricoReal === false && (
                                <span className="ml-1 text-[10px] text-[var(--text-muted)]">(sem venda — peso padrão)</span>
                              )}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
