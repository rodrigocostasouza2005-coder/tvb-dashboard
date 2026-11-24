import { TipoCompraProduto, StatusComercialProduto, PossibilidadeReposicao, type DecisaoCompra } from "@prisma/client";
import type { ProdutoPlanejamentoDetalhe, ClassificacaoAgregada, DecisoesMovimentacaoPorStatus } from "@/lib/metrics";
import { classificarProdutoEmLoteAction } from "../mapa-compras/classificacao-actions";
import { ConfirmarDecisaoForm } from "../mapa-compras/inteligencia/forms";
import { DecisoesMovimentacaoResumo } from "./excesso-distribuicao";
import { formatNumber } from "./format";

const STATUS_COMERCIAL_LABEL: Record<StatusComercialProduto, string> = {
  ATIVO: "Ativo",
  EM_LANCAMENTO: "Em lançamento",
  EM_REPOSICAO: "Em reposição",
  EM_ENCERRAMENTO: "Em encerramento",
  DESCONTINUADO: "Descontinuado",
};

function formatDataCurta(d: Date): string {
  return new Date(d).toLocaleDateString("pt-BR");
}

// Aba 5 "Decisões e Ações" (Zona 3, pedido do Rodrigo): decisões associadas ao produto (comprar/
// não comprar/aguardar/transferir/redistribuir/reduzir exposição/liquidar/revisar). PRESERVA os
// mecanismos de registro de decisão já existentes — classificarProdutoEmLoteAction (mapa-compras),
// confirmarDecisaoCompraAction (via ConfirmarDecisaoForm, mesmo componente usado no Mapa de
// Compras) e DecisaoMovimentacaoEstoque (resumo via DecisoesMovimentacaoResumo, decisão/execução
// continua só na aba Movimentações da Distribuição de Estoque) — NUNCA cria um sistema paralelo.
//
// Novidade real desta aba (não só reorganização): antes, a recomendação de compra aparecia em
// Planejamento de Estoque só como leitura (sem botão "Aprovar") — pra confirmar uma decisão,
// era preciso ir até o Mapa de Compras. Aqui o mesmo ConfirmarDecisaoForm/confirmarDecisaoCompraAction
// já existente é reaproveitado também neste contexto, fechando o ciclo "ver recomendação → decidir"
// sem duplicar lógica nem criar uma 2ª tabela/ação de decisão.
export function AbaDecisoesProduto({
  detalhe,
  classificacao,
  podeClassificar,
  decisoesMovimentacao,
  decisoesCompra,
  distribuicaoHref,
}: {
  detalhe: ProdutoPlanejamentoDetalhe;
  classificacao: ClassificacaoAgregada;
  podeClassificar: boolean;
  decisoesMovimentacao: DecisoesMovimentacaoPorStatus | null;
  decisoesCompra: DecisaoCompra[];
  distribuicaoHref: string;
}) {
  const precisaClassificar = classificacao === "NAO_CLASSIFICADO" || classificacao === "MISTO";

  return (
    <div className="flex flex-col gap-5 p-4">
      {podeClassificar && precisaClassificar && (
        <section>
          <h3 className="mb-1 text-xs font-medium text-[var(--text-muted)]">
            Classificar todos os {detalhe.cods.length} SKU(s) deste produto de uma vez
          </h3>
          <p className="mb-2 text-[11px] text-[var(--text-muted)]">
            {classificacao === "MISTO"
              ? `Os ${detalhe.cods.length} SKU(s) deste produto têm classificações diferentes hoje — a decisão escolhida abaixo substitui TODAS elas pela mesma.`
              : `Nenhum dos ${detalhe.cods.length} SKU(s) deste produto está classificado ainda. A decisão continua 100% manual — isto só evita repetir o clique por cor/tamanho.`}{" "}
            O servidor confere cada SKU contra o cadastro real antes de gravar (nunca aceita um SKU de outro produto).
          </p>
          <form action={classificarProdutoEmLoteAction} className="flex flex-wrap items-end gap-2 text-xs">
            <input type="hidden" name="produto" value={detalhe.produto} />
            {detalhe.cods.map((cod) => (
              <input key={cod} type="hidden" name="cod" value={cod} />
            ))}
            <label className="flex flex-col gap-0.5 text-[var(--text-muted)]">
              Tipo de compra
              <select name="tipoCompra" required defaultValue="" className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-primary)]">
                <option value="" disabled>
                  Selecione
                </option>
                <option value={TipoCompraProduto.BEST_SELLER}>Best Seller</option>
                <option value={TipoCompraProduto.DROP}>Drop</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[var(--text-muted)]">
              Status comercial
              <select name="statusComercial" required defaultValue={StatusComercialProduto.ATIVO} className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-primary)]">
                {Object.values(StatusComercialProduto).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_COMERCIAL_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[var(--text-muted)]">
              Possibilidade de reposição
              <select name="possibilidadeReposicao" required defaultValue={PossibilidadeReposicao.A_CONFIRMAR} className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-primary)]">
                <option value={PossibilidadeReposicao.SIM}>Sim</option>
                <option value={PossibilidadeReposicao.NAO}>Não</option>
                <option value={PossibilidadeReposicao.A_CONFIRMAR}>A confirmar</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[var(--text-muted)]">
              Data de lançamento{classificacao === "NAO_CLASSIFICADO" ? " (obrigatória)" : " (se algum SKU ainda não tiver classificação)"}
              {/* Obrigatória no servidor só quando pelo menos 1 destes SKUs está sendo
                  CLASSIFICADO por aqui pela primeira vez (decisão do Rodrigo 2026-11-19 — nunca
                  retroage aos já classificados). NAO_CLASSIFICADO = todos novos, então exigimos
                  já aqui no form; em MISTO pode ser reclassificação pura de SKUs que já tinham
                  linha, então o campo fica visível mas não bloqueado no cliente — o servidor
                  confere caso a caso em classificarProdutoEmLoteAction. */}
              <input
                type="date"
                name="dataLancamento"
                required={classificacao === "NAO_CLASSIFICADO"}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-primary)]"
              />
            </label>
            <button type="submit" className="rounded-md border border-[var(--border)] px-3 py-1.5 font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
              Classificar {detalhe.cods.length} SKU(s)
            </button>
          </form>
        </section>
      )}

      {podeClassificar && (detalhe.recomendacoesBestSeller.length > 0 || detalhe.recomendacoesDrop.length > 0) && (
        <section>
          <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Confirmar decisão sobre a recomendação de compra</h3>
          <p className="mb-2 text-[11px] text-[var(--text-muted)]">
            Mesmo mecanismo do Mapa de Compras (confirmarDecisaoCompraAction) — grava quantidade sugerida original,
            aprovada e as premissas usadas no momento. A simulação em tela nunca grava nada; só este clique grava.
          </p>
          <div className="flex flex-col gap-2">
            {detalhe.recomendacoesBestSeller.map((r) => (
              <div key={r.cod} className="rounded-md border border-[var(--gridline)] p-2 text-xs">
                <div className="mb-1 text-[var(--text-secondary)]">
                  Best Seller · {r.cod} · sugestão {formatNumber(r.quantidadeSugerida)} un.
                </div>
                <ConfirmarDecisaoForm
                  cod={r.cod}
                  grupo={r.grupo}
                  tipoCompra={TipoCompraProduto.BEST_SELLER}
                  quantidadeSugerida={r.quantidadeSugerida}
                  premissas={{ premissas: r.premissas, avisos: r.avisos }}
                />
              </div>
            ))}
            {detalhe.recomendacoesDrop
              .filter((r) => r.quantidadeSugerida != null)
              .map((r) => (
                <div key={r.cod} className="rounded-md border border-[var(--gridline)] p-2 text-xs">
                  <div className="mb-1 text-[var(--text-secondary)]">
                    Drop · {r.cod} · sugestão {formatNumber(r.quantidadeSugerida ?? 0)} un.
                  </div>
                  <ConfirmarDecisaoForm
                    cod={r.cod}
                    grupo={r.grupo}
                    tipoCompra={TipoCompraProduto.DROP}
                    quantidadeSugerida={r.quantidadeSugerida ?? 0}
                    premissas={{ premissas: r.premissas, avisos: r.avisos }}
                  />
                </div>
              ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Decisões de compra já registradas (DecisaoCompra)</h3>
        {decisoesCompra.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">Nenhuma decisão de compra registrada ainda pros SKU(s) deste produto.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[var(--gridline)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                  <th className="px-3 py-1.5 font-medium">Decidido em</th>
                  <th className="px-3 py-1.5 font-medium">SKU</th>
                  <th className="px-3 py-1.5 font-medium">Tipo</th>
                  <th className="px-3 py-1.5 font-medium text-right">Sugerida</th>
                  <th className="px-3 py-1.5 font-medium text-right">Aprovada</th>
                  <th className="px-3 py-1.5 font-medium">Justificativa do ajuste</th>
                </tr>
              </thead>
              <tbody>
                {decisoesCompra.map((d) => (
                  <tr key={d.id} className="border-b border-[var(--gridline)] last:border-0">
                    <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-secondary)]">{formatDataCurta(d.decididoEm)}</td>
                    <td className="px-3 py-1.5 text-[var(--text-secondary)]">{d.cod ?? "— só grupo —"}</td>
                    <td className="px-3 py-1.5 text-[var(--text-secondary)]">{d.tipoCompra === TipoCompraProduto.BEST_SELLER ? "Best Seller" : "Drop"}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(d.quantidadeSugerida)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(d.quantidadeAprovada)}</td>
                    <td className="px-3 py-1.5 text-[var(--text-muted)]">{d.justificativaAjuste ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-[var(--text-muted)]">Decisões de movimentação/transferência (DecisaoMovimentacaoEstoque)</h3>
          <a href={distribuicaoHref} className="text-[11px] text-[var(--series-1)] hover:underline">
            Abrir na Distribuição de Estoque (aprovar/recusar/executar) →
          </a>
        </div>
        <p className="mb-2 text-[11px] text-[var(--text-muted)]">
          Aprovação/recusa/execução de transferência continua exclusivamente na Distribuição de Estoque (mesmo
          mecanismo já existente) — aqui é só o resumo do que já foi decidido pra este produto.
        </p>
        <DecisoesMovimentacaoResumo decisoes={decisoesMovimentacao} />
      </section>
    </div>
  );
}
