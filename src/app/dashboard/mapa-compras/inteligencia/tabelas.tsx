"use client";

import { useState } from "react";
import { TipoCompraProduto } from "@prisma/client";
import type {
  RecomendacaoBestSellerPorProduto,
  RecomendacaoDropPorProduto,
  LinhaConsolidadaGrupo,
  LinhaPorProduto,
  InfoRedistribuicao,
} from "@/lib/metrics";
import { formatMoeda, formatNumero, indicadorInfo } from "./format";
import { ConfirmarDecisaoForm, ParametrosGrupoForm } from "./forms";

// Badge "Best Seller" (reposição recorrente) vs "Drop" (coleção limitada) — a diferença visual
// pedida na seção 8, sem exagero de cor: só a borda/cor do texto muda, mesmo fundo neutro dos
// outros badges do app (ver GrupoBloco em mapa-compras-grid.tsx).
function TipoBadge({ tipo }: { tipo: TipoCompraProduto }) {
  const bestSeller = tipo === TipoCompraProduto.BEST_SELLER;
  return (
    <span
      className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{
        backgroundColor: `color-mix(in srgb, ${bestSeller ? "var(--series-1)" : "var(--series-2)"} 15%, transparent)`,
        color: bestSeller ? "var(--series-1)" : "var(--series-2)",
      }}
    >
      {bestSeller ? "Best Seller · reposição recorrente" : "Drop · compra de coleção"}
    </span>
  );
}

// Terceiro tipo visual (pedido de 2026-10-29): redistribuição interna NÃO é compra — badge só com
// contorno (sem preenchimento), pra nunca ser confundida com as duas de compra acima.
export function RedistribuicaoBadge({ info }: { info: InfoRedistribuicao | undefined }) {
  if (!info || info.unidadesTransferiveis <= 0) return null;
  return (
    <a
      href="/dashboard/distribuicao-estoque?aba=transferencias"
      title="Sugestão de remanejamento entre lojas (Distribuição de Estoque). Não altera a quantidade de compra: o estoque total continua o mesmo."
      className="mt-1 inline-block whitespace-nowrap rounded-full border border-dashed border-[var(--text-muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
    >
      ↔ Redistribuição interna: {info.unidadesTransferiveis} un entre lojas
    </a>
  );
}

function rotuloVariante(r: { cod: string; cor: string | null; tamanho: string | null }) {
  return (
    <div className="text-[10px] text-[var(--text-muted)]">
      SKU {r.cod} · {r.cor ?? "cor —"} · tam. {r.tamanho ?? "—"}
    </div>
  );
}

function RiscoBadge({ label, tom }: { label: string; tom: "critical" | "warning" | "good" }) {
  const cor = tom === "critical" ? "var(--status-critical)" : tom === "warning" ? "var(--status-warning)" : "var(--status-good)";
  return (
    <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${cor} 15%, transparent)`, color: cor }}>
      {label}
    </span>
  );
}

// Lista de avisos/premissas — fica num <details> por linha pra não poluir a tabela, mas sem
// esconder a justificativa (pedido explícito: "quantidade sugerida, verba estimada e a
// justificativa... devem ficar fáceis de achar — sem virarem um número mágico").
function Premissas({ premissas, avisos }: { premissas: string[]; avisos: string[] }) {
  if (premissas.length === 0 && avisos.length === 0) return null;
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
        Por quê? ({premissas.length + avisos.length})
      </summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10px] text-[var(--text-muted)]">
        {avisos.map((a, i) => (
          <li key={`a-${i}`} style={{ color: "var(--status-warning)" }}>
            {a}
          </li>
        ))}
        {premissas.map((p, i) => (
          <li key={`p-${i}`}>{p}</li>
        ))}
      </ul>
    </details>
  );
}

const th = "border-b border-[var(--border)] px-3 py-2 text-left text-xs font-medium text-[var(--text-secondary)]";
const td = "border-b border-[var(--gridline)] px-3 py-2 text-xs";

export function TabelaBestSeller({
  rows,
  redistribuicao,
}: {
  rows: RecomendacaoBestSellerPorProduto[];
  redistribuicao?: Map<string, InfoRedistribuicao>;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Nenhum produto classificado como Best Seller no filtro atual.</p>;
  }
  const ordenadas = [...rows].sort((a, b) => b.quantidadeSugerida - a.quantidadeSugerida);
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
      <table className="w-full min-w-[1080px] border-collapse">
        <thead>
          <tr>
            <th className={th}>Produto</th>
            <th className={th}>Grupo</th>
            <th className={`${th} text-right`}>Vendas líq. 30/60/90d</th>
            <th className={`${th} text-right`}>Estoque disp.</th>
            <th className={`${th} text-right`}>Demanda projetada</th>
            <th className={`${th} text-right`}>Cobertura</th>
            <th className={`${th} text-right`}>Qtd. sugerida</th>
            <th className={`${th} text-right`}>Valor estimado</th>
            <th className={th}>Confirmar</th>
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((r) => (
            <tr key={r.cod} className="hover:bg-[var(--page-plane)]">
              <td className={td}>
                <div className="font-medium text-[var(--text-primary)]">{r.produto}</div>
                {rotuloVariante(r)}
                {!r.confiavel && <RiscoBadge label="Baixa confiança" tom="warning" />}
                {r.rupturaAtual && <RiscoBadge label="Zerado: venda pode estar subestimada" tom="warning" />}
                <RedistribuicaoBadge info={redistribuicao?.get(r.cod)} />
                <Premissas premissas={r.premissas} avisos={r.avisos} />
              </td>
              <td className={`${td} text-[var(--text-secondary)]`}>{r.grupo}</td>
              <td className={`${td} text-right tabular-nums`}>
                {formatNumero(r.vendasLiquidas.d30)}/{formatNumero(r.vendasLiquidas.d60)}/{formatNumero(r.vendasLiquidas.d90)}
              </td>
              <td className={`${td} text-right tabular-nums`}>{formatNumero(r.estoqueDisponivelUtilizavel)}</td>
              <td className={`${td} text-right tabular-nums`}>{formatNumero(r.demandaProjetadaHorizonte, 1)}</td>
              <td className={`${td} text-right tabular-nums`}>
                {r.coberturaAtualDias != null ? `${formatNumero(r.coberturaAtualDias, 1)}d` : "—"}
                {r.coberturaAtualDias != null && r.coberturaAtualDias < 7 && (
                  <span className="ml-1">
                    <RiscoBadge label="ruptura" tom="critical" />
                  </span>
                )}
              </td>
              <td className={`${td} text-right font-semibold tabular-nums text-[var(--text-primary)]`}>{formatNumero(r.quantidadeSugerida)}</td>
              <td className={`${td} text-right tabular-nums`}>{formatMoeda(r.valorEstimado)}</td>
              <td className={td}>
                {r.quantidadeSugerida > 0 && (
                  <ConfirmarDecisaoForm
                    cod={r.cod}
                    grupo={r.grupo}
                    tipoCompra={TipoCompraProduto.BEST_SELLER}
                    quantidadeSugerida={r.quantidadeSugerida}
                    premissas={{ premissas: r.premissas, avisos: r.avisos }}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TabelaDrop({
  rows,
  redistribuicao,
}: {
  rows: RecomendacaoDropPorProduto[];
  redistribuicao?: Map<string, InfoRedistribuicao>;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Nenhum produto classificado como Drop no filtro atual.</p>;
  }
  const ordenadas = [...rows].sort((a, b) => Number(b.riscoRuptura) - Number(a.riscoRuptura));
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
      <table className="w-full min-w-[1040px] border-collapse">
        <thead>
          <tr>
            <th className={th}>Produto</th>
            <th className={th}>Coleção</th>
            <th className={`${th} text-right`}>Estoque disp.</th>
            <th className={`${th} text-right`}>Sell-through</th>
            <th className={`${th} text-right`}>Previsão até fim da janela</th>
            <th className={`${th} text-right`}>Dias restantes</th>
            <th className={th}>Risco</th>
            <th className={`${th} text-right`}>Qtd. sugerida</th>
            <th className={`${th} text-right`}>Valor estimado</th>
            <th className={th}>Confirmar</th>
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((r) => (
            <tr key={r.cod} className="hover:bg-[var(--page-plane)]">
              <td className={td}>
                <div className="font-medium text-[var(--text-primary)]">{r.produto}</div>
                {rotuloVariante(r)}
                <RedistribuicaoBadge info={redistribuicao?.get(r.cod)} />
                {r.bloqueadoRecompra && <RiscoBadge label="Recompra bloqueada" tom="warning" />}
                {r.precisaConfirmacaoHumana && <RiscoBadge label="Precisa confirmação" tom="warning" />}
                <Premissas premissas={r.premissas} avisos={r.avisos} />
              </td>
              <td className={`${td} text-[var(--text-secondary)]`}>{r.colecao}</td>
              <td className={`${td} text-right tabular-nums`}>{formatNumero(r.estoqueDisponivel)}</td>
              <td className={`${td} text-right tabular-nums`}>{r.sellThroughAtual != null ? `${formatNumero(r.sellThroughAtual, 1)}%` : "—"}</td>
              <td className={`${td} text-right tabular-nums`}>{formatNumero(r.previsaoVendaAteFimJanela, 1)}</td>
              <td className={`${td} text-right tabular-nums`}>{r.diasRestantesJanela ?? "sem data"}</td>
              <td className={td}>
                {!r.janelaConhecida && <RiscoBadge label="Janela desconhecida" tom="warning" />}
                {r.riscoRuptura && <RiscoBadge label="Ruptura" tom="critical" />}
                {r.riscoSobra && <RiscoBadge label="Sobra" tom="warning" />}
                {r.janelaConhecida && !r.riscoRuptura && !r.riscoSobra && <RiscoBadge label="Equilíbrio" tom="good" />}
              </td>
              <td className={`${td} text-right font-semibold tabular-nums text-[var(--text-primary)]`}>
                {r.quantidadeSugerida != null ? formatNumero(r.quantidadeSugerida) : "—"}
              </td>
              <td className={`${td} text-right tabular-nums`}>{formatMoeda(r.valorEstimado)}</td>
              <td className={td}>
                {r.quantidadeSugerida != null && r.quantidadeSugerida > 0 && (
                  <ConfirmarDecisaoForm
                    cod={r.cod}
                    grupo={r.grupo}
                    tipoCompra={TipoCompraProduto.DROP}
                    quantidadeSugerida={r.quantidadeSugerida}
                    premissas={{ premissas: r.premissas, avisos: r.avisos }}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Visão por grupo (seção 6) — linha por grupo, expandível pros produtos Best Seller/Drop dentro
// dele, mesmo padrão de expand/collapse de GrupoBloco em mapa-compras-grid.tsx (▸ rotaciona,
// coluna esquerda sticky).
function GrupoLinha({
  linha,
  bsDoGrupo,
  dropDoGrupo,
  canEdit,
  coberturaMetaPorGrupo,
}: {
  linha: LinhaConsolidadaGrupo;
  bsDoGrupo: RecomendacaoBestSellerPorProduto[];
  dropDoGrupo: RecomendacaoDropPorProduto[];
  canEdit: boolean;
  coberturaMetaPorGrupo: Map<string, { estoqueSegurancaUnidades: number | null; leadTimeDias: number | null }>;
}) {
  const [aberto, setAberto] = useState(false);
  const info = indicadorInfo(linha.indicador);
  const meta = coberturaMetaPorGrupo.get(linha.grupo) ?? { estoqueSegurancaUnidades: null, leadTimeDias: null };

  return (
    <>
      <tr className="border-t-2 border-[var(--border)]">
        <td className="px-3 py-2">
          <button type="button" onClick={() => setAberto((v) => !v)} className="flex items-center gap-1.5 text-left text-sm font-semibold text-[var(--text-primary)]">
            <span className="inline-block w-3 text-[var(--text-muted)] transition-transform" style={{ transform: aberto ? "rotate(90deg)" : "rotate(0deg)" }}>
              ▸
            </span>
            {linha.grupo}
          </button>
        </td>
        <td className={`${td} text-right tabular-nums`}>{formatNumero(linha.bestSeller.estoqueAtual + linha.drop.estoqueAtual)}</td>
        <td className={`${td} text-right tabular-nums`}>{formatNumero(linha.bestSeller.demandaPrevista + linha.drop.demandaPrevista, 1)}</td>
        <td className={`${td} text-right tabular-nums`}>{linha.bestSeller.coberturaDias != null ? `${formatNumero(linha.bestSeller.coberturaDias, 1)}d` : "—"}</td>
        <td className={`${td} text-right tabular-nums`}>{formatNumero(linha.quantidadeSugeridaTotal)}</td>
        <td className={`${td} text-right tabular-nums`}>{formatMoeda(linha.valorEstimadoTotal)}</td>
        <td className={`${td} text-right tabular-nums`}>{linha.participacaoVerbaSugeridaPct != null ? `${formatNumero(linha.participacaoVerbaSugeridaPct, 1)}%` : "—"}</td>
        <td className={td}>
          <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${info.color} 15%, transparent)`, color: info.color }}>
            {info.label}
          </span>
        </td>
        <td className={td}>
          <ParametrosGrupoForm grupo={linha.grupo} estoqueSegurancaUnidades={meta.estoqueSegurancaUnidades} leadTimeDias={meta.leadTimeDias} canEdit={canEdit} />
        </td>
      </tr>
      {aberto && (
        <tr>
          <td colSpan={9} className="bg-[var(--page-plane)] p-3">
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-[10px] font-semibold text-[var(--text-muted)]">BEST SELLER ({bsDoGrupo.length})</p>
                <TabelaBestSeller rows={bsDoGrupo} />
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold text-[var(--text-muted)]">DROP ({dropDoGrupo.length})</p>
                <TabelaDrop rows={dropDoGrupo} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function TabelaPorGrupo({
  porGrupo,
  bsRows,
  dropRows,
  canEdit,
  coberturaMetaPorGrupo,
}: {
  porGrupo: LinhaConsolidadaGrupo[];
  bsRows: RecomendacaoBestSellerPorProduto[];
  dropRows: RecomendacaoDropPorProduto[];
  canEdit: boolean;
  coberturaMetaPorGrupo: Map<string, { estoqueSegurancaUnidades: number | null; leadTimeDias: number | null }>;
}) {
  if (porGrupo.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Nenhum grupo com produto classificado no filtro atual.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
      <table className="w-full min-w-[980px] border-collapse">
        <thead>
          <tr>
            <th className={th}>Grupo</th>
            <th className={`${th} text-right`}>Estoque atual</th>
            <th className={`${th} text-right`}>Demanda prevista</th>
            <th className={`${th} text-right`}>Cobertura (BS)</th>
            <th className={`${th} text-right`}>Qtd. sugerida</th>
            <th className={`${th} text-right`}>Valor estimado</th>
            <th className={`${th} text-right`}>% da verba sugerida</th>
            <th className={th}>Indicador</th>
            <th className={th}>Parâmetros Best Seller</th>
          </tr>
        </thead>
        <tbody>
          {porGrupo.map((linha) => (
            <GrupoLinha
              key={linha.grupo}
              linha={linha}
              bsDoGrupo={bsRows.filter((r) => r.grupo === linha.grupo)}
              dropDoGrupo={dropRows.filter((r) => r.grupo === linha.grupo)}
              canEdit={canEdit}
              coberturaMetaPorGrupo={coberturaMetaPorGrupo}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Visão por produto (seção 6: "detalhar... até chegar ao produto") — produto (nome) com o detalhe
// por cor/tamanho (cod) num <details>. A soma das variantes é o total do produto, e a soma dos
// produtos de um grupo bate com o total do grupo no modo "Por grupo" (agregarPorProduto).
export function TabelaPorProduto({ linhas }: { linhas: LinhaPorProduto[] }) {
  if (linhas.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Nenhum produto classificado no filtro atual.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
      <table className="w-full min-w-[860px] border-collapse">
        <thead>
          <tr>
            <th className={th}>Produto</th>
            <th className={th}>Tipo</th>
            <th className={th}>Grupo</th>
            <th className={th}>Coleção</th>
            <th className={`${th} text-right`}>Estoque</th>
            <th className={`${th} text-right`}>Qtd. sugerida</th>
            <th className={`${th} text-right`}>Valor estimado</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.chave} className="hover:bg-[var(--page-plane)]">
              <td className={td}>
                <details>
                  <summary className="cursor-pointer font-medium text-[var(--text-primary)]">
                    {l.produto} <span className="text-[10px] text-[var(--text-muted)]">({l.variantes.length} variante(s))</span>
                  </summary>
                  <table className="mt-1 w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="px-2 py-1 text-left text-[10px] font-medium text-[var(--text-muted)]">SKU · cor · tamanho</th>
                        <th className="px-2 py-1 text-right text-[10px] font-medium text-[var(--text-muted)]">Estoque</th>
                        <th className="px-2 py-1 text-right text-[10px] font-medium text-[var(--text-muted)]">Qtd.</th>
                        <th className="px-2 py-1 text-right text-[10px] font-medium text-[var(--text-muted)]">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {l.variantes.map((v) => (
                        <tr key={v.cod}>
                          <td className="px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
                            {v.cod} · {v.cor ?? "—"} · {v.tamanho ?? "—"}
                          </td>
                          <td className="px-2 py-0.5 text-right text-[10px] tabular-nums">{formatNumero(v.estoque)}</td>
                          <td className="px-2 py-0.5 text-right text-[10px] tabular-nums">{v.quantidadeSugerida == null ? "—" : formatNumero(v.quantidadeSugerida)}</td>
                          <td className="px-2 py-0.5 text-right text-[10px] tabular-nums">{formatMoeda(v.valorEstimado)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </td>
              <td className={td}>
                <TipoBadge tipo={l.tipoCompra} />
              </td>
              <td className={`${td} text-[var(--text-secondary)]`}>{l.grupo}</td>
              <td className={`${td} text-[var(--text-secondary)]`}>{l.colecao ?? "—"}</td>
              <td className={`${td} text-right tabular-nums`}>{formatNumero(l.estoque)}</td>
              <td className={`${td} text-right tabular-nums`}>{formatNumero(l.quantidadeSugerida)}</td>
              <td className={`${td} text-right tabular-nums`}>
                {formatMoeda(l.valorEstimado)}
                {l.variantesSemCusto > 0 && <div className="text-[10px]" style={{ color: "var(--status-warning)" }}>{l.variantesSemCusto} variante(s) sem custo</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
