import type { RecomendacaoBestSellerPorProduto, RecomendacaoDropPorProduto, OportunidadeTransferenciaPorCod } from "@/lib/metrics";
import { formatMoeda, formatNumero } from "./format";
import { ClassificarProdutoForm } from "./forms";

type FilaItem = { cod: string; produto: string; grupo: string; colecao: string | null };

// Alertas e prioridades (seção 8, último modo do toggle): junta os riscos já calculados (ruptura
// Best Seller, ruptura/sobra Drop) com a fila de revisão de classificação — produto sem
// classificação aparece SÓ aqui, nunca nas tabelas de Best Seller/Drop (pedido explícito, seção
// 3: nunca tratar desconhecido como um dos dois até alguém decidir).
export function AlertasView({
  bsRows,
  dropRows,
  filaRevisao,
  oportunidadesTransferencia,
}: {
  bsRows: RecomendacaoBestSellerPorProduto[];
  dropRows: RecomendacaoDropPorProduto[];
  filaRevisao: FilaItem[];
  // Sinal ADITIVO (docs/planejamento-inteligente-estoque.md §16.2 item 3 e §19.6): mapa de cod ->
  // oportunidade de transferência já calculada pelo motor de distribuição (getExcessosEDistribuicao,
  // via getCodsComOportunidadeTransferencia) — nunca recalculado aqui, nunca altera
  // quantidadeSugerida de nenhuma recomendação de compra abaixo. Opcional pra não quebrar nenhum
  // outro chamador existente do componente.
  oportunidadesTransferencia?: Map<string, OportunidadeTransferenciaPorCod>;
}) {
  const rupturaBS = bsRows.filter((r) => r.coberturaAtualDias != null && r.coberturaAtualDias < 7 && r.quantidadeSugerida > 0);
  const rupturaDrop = dropRows.filter((r) => r.riscoRuptura);
  const sobraDrop = dropRows.filter((r) => r.riscoSobra);
  const bloqueadosOuPendentes = dropRows.filter((r) => r.bloqueadoRecompra || r.precisaConfirmacaoHumana);

  // Sinal "há excesso disponível antes de comprar": só olha os cods que JÁ aparecem nas seções de
  // risco de ruptura acima (Best Seller e Drop) — é exatamente aí que a pergunta "comprar ou só
  // transferir?" importa. Nunca toca quantidadeSugerida/valorEstimado de nenhuma linha.
  const oportunidadesEmRisco = (oportunidadesTransferencia ?? new Map<string, OportunidadeTransferenciaPorCod>());
  const riscoComOportunidade = [
    ...rupturaBS.map((r) => ({ cod: r.cod, produto: r.produto, grupo: r.grupo })),
    ...rupturaDrop.map((r) => ({ cod: r.cod, produto: r.produto, grupo: r.grupo })),
  ]
    .filter((r) => oportunidadesEmRisco.has(r.cod))
    .map((r) => ({ ...r, oportunidade: oportunidadesEmRisco.get(r.cod)! }));

  return (
    <div className="space-y-5">
      {riscoComOportunidade.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium" style={{ color: "var(--status-warning)" }}>
            Excesso disponível para transferência antes de comprar ({riscoComOportunidade.length})
          </h3>
          <p className="mb-2 text-[10px] text-[var(--text-muted)]">
            Estes cods já aparecem em risco de ruptura acima, mas o motor de Distribuição de
            Estoque (intocado, mesmo cálculo já validado) encontrou excesso disponível em outra
            posição — considere transferir antes de aumentar a compra. Isto é só um aviso: a
            sugestão de compra acima não muda.
          </p>
          <ul className="space-y-1">
            {riscoComOportunidade.map((r) => (
              <li key={r.cod} className="rounded-md border px-2 py-1.5 text-xs" style={{ borderColor: "var(--status-warning)" }}>
                <strong>{r.produto}</strong> ({r.grupo}, {r.cod}) — há {formatNumero(r.oportunidade.quantidadeSugerida)} unidade(s)
                disponível(is) em {r.oportunidade.origemNome} — considere transferir antes de comprar.{" "}
                <a
                  href={`/dashboard/distribuicao-estoque?aba=movimentacoes&busca=${encodeURIComponent(r.produto)}`}
                  className="text-[var(--series-1)] hover:underline"
                >
                  Abrir na Distribuição de Estoque →
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-medium" style={{ color: "var(--status-critical)" }}>
          Risco de ruptura — Best Seller ({rupturaBS.length})
        </h3>
        {rupturaBS.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">Nenhum Best Seller com cobertura abaixo de 7 dias no filtro atual.</p>
        ) : (
          <ul className="space-y-1">
            {rupturaBS.map((r) => (
              <li key={r.cod} className="rounded-md border border-[var(--gridline)] bg-[var(--surface-1)] p-2 text-xs">
                <strong>{r.produto}</strong> ({r.grupo}) — cobertura de {formatNumero(r.coberturaAtualDias, 1)} dia(s), sugestão de compra: {formatNumero(r.quantidadeSugerida)} un ({formatMoeda(r.valorEstimado)})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-medium" style={{ color: "var(--status-critical)" }}>
          Risco de ruptura dentro da janela — Drop ({rupturaDrop.length})
        </h3>
        {rupturaDrop.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">Nenhum Drop com risco de ruptura antes do fim da janela comercial.</p>
        ) : (
          <ul className="space-y-1">
            {rupturaDrop.map((r) => (
              <li key={r.cod} className="rounded-md border border-[var(--gridline)] bg-[var(--surface-1)] p-2 text-xs">
                <strong>{r.produto}</strong> ({r.colecao}) — faltam {formatNumero(r.faltanteEstimado)} un pros {r.diasRestantesJanela} dia(s) restantes de janela.
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-medium" style={{ color: "var(--status-warning)" }}>
          Risco de sobra — Drop ({sobraDrop.length})
        </h3>
        {sobraDrop.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">Nenhum Drop com estoque muito acima da previsão de venda até o fim da janela.</p>
        ) : (
          <ul className="space-y-1">
            {sobraDrop.map((r) => (
              <li key={r.cod} className="rounded-md border border-[var(--gridline)] bg-[var(--surface-1)] p-2 text-xs">
                <strong>{r.produto}</strong> ({r.colecao}) — excedente estimado de {formatNumero(r.excedenteEstimado)} un acima da previsão até o fim da janela.
              </li>
            ))}
          </ul>
        )}
      </section>

      {bloqueadosOuPendentes.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">Decisões que exigem intervenção humana ({bloqueadosOuPendentes.length})</h3>
          <ul className="space-y-1">
            {bloqueadosOuPendentes.map((r) => (
              <li key={r.cod} className="rounded-md border border-[var(--gridline)] bg-[var(--surface-1)] p-2 text-xs">
                <strong>{r.produto}</strong> ({r.colecao}) — {r.bloqueadoRecompra ? "reposição não permitida, recompra automática bloqueada" : "possibilidade de reposição ainda não confirmada"}.
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
          Fila de revisão — produtos sem classificação ({filaRevisao.length})
        </h3>
        <p className="mb-2 text-[10px] text-[var(--text-muted)]">
          Aparecem aqui por terem venda ou estoque recente, mas nenhuma classificação cadastrada ainda — nunca tratados como Best Seller ou Drop até você decidir.
        </p>
        {filaRevisao.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">Nenhum produto pendente de classificação.</p>
        ) : (
          <ul className="space-y-2">
            {filaRevisao.map((p) => (
              <li key={p.cod} className="rounded-md border border-[var(--gridline)] bg-[var(--surface-1)] p-2">
                <div className="mb-1 text-xs">
                  <strong>{p.produto}</strong> <span className="text-[var(--text-muted)]">({p.grupo}{p.colecao ? ` · ${p.colecao}` : ""})</span>
                </div>
                <ClassificarProdutoForm cod={p.cod} produto={p.produto} grupo={p.grupo} colecao={p.colecao} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
