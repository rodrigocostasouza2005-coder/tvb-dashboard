import type { RecomendacaoBestSellerPorProduto, RecomendacaoDropPorProduto, NecessidadeSemCusto, InfoRedistribuicao } from "@/lib/metrics";
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
  necessidadesSemCusto = [],
  redistribuicao = new Map(),
  distribuicaoResumo = null,
}: {
  bsRows: RecomendacaoBestSellerPorProduto[];
  dropRows: RecomendacaoDropPorProduto[];
  filaRevisao: FilaItem[];
  necessidadesSemCusto?: NecessidadeSemCusto[];
  redistribuicao?: Map<string, InfoRedistribuicao>;
  distribuicaoResumo?: { status: string; transferencias: number; unidades: number; insuficienciaGlobal: number } | null;
}) {
  const nomePorCod = new Map<string, string>([
    ...bsRows.map((r) => [r.cod, `${r.produto}${r.tamanho ? ` · tam. ${r.tamanho}` : ""}`] as [string, string]),
    ...dropRows.map((r) => [r.cod, `${r.produto}${r.tamanho ? ` · tam. ${r.tamanho}` : ""}`] as [string, string]),
  ]);
  const redistribuiveis = [...redistribuicao.entries()].filter(([, i]) => i.unidadesTransferiveis > 0);
  const insuficientes = [...redistribuicao.entries()].filter(([, i]) => i.estoqueTotalInsuficiente);
  const dropsSemJanela = dropRows.filter((r) => !r.janelaConhecida);
  const bsZerados = bsRows.filter((r) => r.rupturaAtual);
  const rupturaBS = bsRows.filter((r) => r.coberturaAtualDias != null && r.coberturaAtualDias < 7 && r.quantidadeSugerida > 0);
  const rupturaDrop = dropRows.filter((r) => r.riscoRuptura);
  const sobraDrop = dropRows.filter((r) => r.riscoSobra);
  const bloqueadosOuPendentes = dropRows.filter((r) => r.bloqueadoRecompra || r.precisaConfirmacaoHumana);

  return (
    <div className="space-y-5">
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

      {(necessidadesSemCusto.length > 0 || dropsSemJanela.length > 0 || bsZerados.length > 0) && (
        <section>
          <h3 className="mb-2 text-sm font-medium" style={{ color: "var(--status-warning)" }}>
            Dados incompletos — revisão humana
          </h3>
          <ul className="space-y-1 text-xs">
            {necessidadesSemCusto.map((n) => (
              <li key={n.id} className="rounded-md border border-[var(--gridline)] bg-[var(--surface-1)] p-2">
                <strong>{n.produto}</strong> ({n.grupo}) — necessidade de {formatNumero(n.quantidadeSugerida)} un sem custo unitário confiável: fora da verba e da priorização por orçamento.
              </li>
            ))}
            {dropsSemJanela.map((r) => (
              <li key={`j-${r.cod}`} className="rounded-md border border-[var(--gridline)] bg-[var(--surface-1)] p-2">
                <strong>{r.produto}</strong> ({r.colecao}) — Drop sem data prevista de encerramento: risco e quantidade não calculados.
              </li>
            ))}
            {bsZerados.map((r) => (
              <li key={`z-${r.cod}`} className="rounded-md border border-[var(--gridline)] bg-[var(--surface-1)] p-2">
                <strong>{r.produto}</strong>{r.tamanho ? ` · tam. ${r.tamanho}` : ""} ({r.grupo}) — Best Seller zerado: a venda observada pode estar subestimada pela ruptura; a sugestão não estima venda perdida.
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-dashed border-[var(--text-muted)] p-3">
        <h3 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">↔ Distribuição de estoque entre lojas — redistribuição interna, não é compra</h3>
        <p className="mb-2 text-[10px] text-[var(--text-muted)]">
          Remanejamento do estoque que já existe. Não muda a quantidade de compra acima (que já considera o estoque total). Toda transferência é só sugestão, para aprovação humana.
        </p>
        {distribuicaoResumo == null ? (
          <p className="text-xs text-[var(--text-muted)]">Análise de distribuição indisponível.</p>
        ) : (
          <>
            <p className="mb-2 text-xs">
              Catálogo inteiro: <strong>{formatNumero(distribuicaoResumo.transferencias)}</strong> sugestão(ões) de transferência ({formatNumero(distribuicaoResumo.unidades)} un) e{" "}
              <strong>{formatNumero(distribuicaoResumo.insuficienciaGlobal)}</strong> variante(s) com estoque total insuficiente.{" "}
              <a className="underline" href="/dashboard/distribuicao-estoque">
                Abrir Distribuição entre lojas
              </a>
            </p>
            {redistribuiveis.length > 0 && (
              <ul className="space-y-1 text-xs">
                {redistribuiveis.slice(0, 20).map(([cod, i]) => (
                  <li key={cod} className="rounded-md border border-[var(--gridline)] bg-[var(--surface-1)] p-2">
                    <strong>{nomePorCod.get(cod) ?? cod}</strong> — {formatNumero(i.unidadesTransferiveis)} un remanejáveis em {i.transferencias} transferência(s) sugerida(s).
                  </li>
                ))}
              </ul>
            )}
            {insuficientes.length > 0 && (
              <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
                Entre os produtos classificados, {insuficientes.length} têm falta em todas as lojas (transferência não resolve — avaliar compra/reposição): {insuficientes.slice(0, 10).map(([cod]) => nomePorCod.get(cod) ?? cod).join(", ")}.
              </p>
            )}
          </>
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
