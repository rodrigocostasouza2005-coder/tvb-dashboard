"use client";

import { Fragment, useState } from "react";
import type { MovimentacaoRecomendada, RecomendacaoManter } from "@/lib/metrics";
import {
  formatNumero,
  classificacaoInfo,
  prioridadeInfo,
  confiancaInfo,
  diagnosticoInfo,
} from "./format";
import { registrarDecisaoMovimentacaoAction } from "./actions";

// Aba 2 — Movimentações. UMA linha por recomendação (as 3 direções na mesma tabela, diferenciadas
// pela coluna Tipo), expansível no clique. Client component só por causa da expansão e do envio da
// decisão — os dados em si vêm prontos do servidor.
//
// Nada aqui executa movimentação física: "Aprovar" grava a DECISÃO humana sobre a recomendação
// (DecisaoMovimentacaoEstoque), que é o que a equipe usa pra acompanhar o que foi feito. A peça só
// se move quando alguém move, fora do Radar.
const TIPO_LABEL: Record<MovimentacaoRecomendada["tipoMovimentacao"], string> = {
  loja_loja: "Loja → Loja",
  cd_site_loja: "CD/Site → Loja",
  loja_cd_site: "Loja → CD/Site",
};

function Badge({ color, children, title }: { color: string; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
    >
      {children}
    </span>
  );
}

function DetalheLinha({ m, podeDecidir }: { m: MovimentacaoRecomendada; podeDecidir: boolean }) {
  const [estado, setEstado] = useState<"idle" | "enviando" | "ok" | "erro">("idle");
  const [mensagem, setMensagem] = useState<string>("");

  async function decidir(status: "APROVADA" | "RECUSADA" | "PENDENTE") {
    setEstado("enviando");
    const r = await registrarDecisaoMovimentacaoAction({
      cod: m.cod,
      produto: m.produto,
      grupo: m.grupo,
      cor: m.cor,
      tamanho: m.tamanho,
      origemPosicaoId: m.origemPosicaoId,
      origemNome: m.origemNome,
      destinoPosicaoId: m.destinoPosicaoId,
      destinoNome: m.destinoNome,
      tipoMovimentacao: m.tipoMovimentacao,
      classificacao: m.classificacao,
      quantidadeSugerida: m.quantidadeSugerida,
      quantidadeAprovada: status === "APROVADA" ? m.quantidadeSugerida : null,
      status,
      confianca: m.confianca,
      premissas: {
        justificativa: m.justificativa,
        impactoEsperado: m.impactoEsperado,
        avisos: m.avisos,
        estoqueOrigemAntes: m.estoqueOrigemAntes,
        estoqueDestinoAntes: m.estoqueDestinoAntes,
        coberturaOrigemAntes: m.coberturaOrigemAntes,
        coberturaDestinoAntes: m.coberturaDestinoAntes,
        prioridade: m.prioridade,
      },
    });
    setEstado(r.ok ? "ok" : "erro");
    setMensagem(r.mensagem);
  }

  return (
    <div className="grid grid-cols-1 gap-3 bg-[var(--page-plane)] px-4 py-3 text-xs lg:grid-cols-3">
      <div className="space-y-1">
        <h4 className="font-semibold text-[var(--text-primary)]">Posições</h4>
        <p className="text-[var(--text-secondary)]">
          <strong>{m.origemNome}</strong> (origem): {formatNumero(m.estoqueOrigemAntes)} un. em estoque,{" "}
          {formatNumero(m.disponivelOrigem)} un. disponíveis acima do mínimo · resta{" "}
          {formatNumero(m.estoqueOrigemDepois)} un. depois de mover.
        </p>
        <p className="text-[var(--text-secondary)]">
          <strong>{m.destinoNome}</strong> (destino): {formatNumero(m.estoqueDestinoAntes)} →{" "}
          {formatNumero(m.estoqueDestinoDepois)} un.
        </p>
        <p className="text-[var(--text-muted)]">
          Cobertura origem {formatNumero(m.coberturaOrigemAntes, 1)} → {formatNumero(m.coberturaOrigemDepois, 1)} dias · destino{" "}
          {formatNumero(m.coberturaDestinoAntes, 1)} → {formatNumero(m.coberturaDestinoDepois, 1)} dias
        </p>
        <p className="text-[var(--text-muted)]">
          Vendas origem 30/90d: {formatNumero(m.vendasOrigem30)}/{formatNumero(m.vendasOrigem90)} · destino{" "}
          {formatNumero(m.vendasDestino30)}/{formatNumero(m.vendasDestino90)}
        </p>
        <p className="text-[var(--text-muted)]">
          Giro diário origem {formatNumero(m.giroOrigemDia, 2)} un./dia · destino {formatNumero(m.giroDestinoDia, 2)} un./dia
        </p>
        <p className="text-[var(--text-primary)]">
          <strong>Quantidade sugerida: {formatNumero(m.quantidadeSugerida)} un.</strong>
        </p>
      </div>

      <div className="space-y-1">
        <h4 className="font-semibold text-[var(--text-primary)]">Grade por tamanho ({m.produto}
          {m.cor ? ` · ${m.cor}` : ""})</h4>
        {m.gradeTamanhos && m.gradeTamanhos.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[var(--text-muted)]">
                  <th className="py-0.5 pr-2 font-medium">Tam.</th>
                  <th className="py-0.5 pr-2 text-right font-medium">Origem</th>
                  <th className="py-0.5 pr-2 text-right font-medium">Vd.90</th>
                  <th className="py-0.5 pr-2 text-right font-medium">Destino</th>
                  <th className="py-0.5 text-right font-medium">Vd.90</th>
                </tr>
              </thead>
              <tbody>
                {m.gradeTamanhos.map((g) => (
                  <tr key={g.tamanho} className="border-t border-[var(--gridline)]">
                    <td className="py-0.5 pr-2 whitespace-nowrap">
                      <span className={g.nucleo ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}>
                        {g.tamanho}
                      </span>
                      {g.tamanho === m.tamanho && <span className="ml-1 text-[var(--series-1)]">←</span>}
                    </td>
                    <td className="py-0.5 pr-2 text-right tabular-nums">{formatNumero(g.estoqueOrigem)}</td>
                    <td className="py-0.5 pr-2 text-right tabular-nums text-[var(--text-muted)]">{formatNumero(g.vendas90Origem)}</td>
                    <td className="py-0.5 pr-2 text-right tabular-nums">{formatNumero(g.estoqueDestino)}</td>
                    <td className="py-0.5 text-right tabular-nums text-[var(--text-muted)]">{formatNumero(g.vendas90Destino)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              Tamanhos 38/40/42/44 em negrito (núcleo do negócio); os demais entram na análise do mesmo jeito.
            </p>
          </div>
        ) : (
          <p className="text-[var(--text-muted)]">Sem outras variantes de tamanho deste produto no filtro atual.</p>
        )}
      </div>

      <div className="space-y-1">
        <h4 className="font-semibold text-[var(--text-primary)]">Justificativa</h4>
        <ul className="list-disc space-y-0.5 pl-4 text-[var(--text-secondary)]">
          {m.justificativa.map((j, i) => (
            <li key={i}>{j}</li>
          ))}
        </ul>
        <p className="pt-1 text-[var(--text-secondary)]">
          <strong>Impacto esperado:</strong> {m.impactoEsperado}
        </p>
        {m.avisos.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-4" style={{ color: "var(--status-critical)" }}>
            {m.avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        )}

        {podeDecidir && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              disabled={estado === "enviando"}
              onClick={() => decidir("APROVADA")}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)] disabled:opacity-50"
            >
              Aprovar recomendação
            </button>
            <button
              type="button"
              disabled={estado === "enviando"}
              onClick={() => decidir("RECUSADA")}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)] disabled:opacity-50"
            >
              Recusar
            </button>
            <button
              type="button"
              disabled={estado === "enviando"}
              onClick={() => decidir("PENDENTE")}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)] disabled:opacity-50"
            >
              Deixar pendente
            </button>
            {mensagem && (
              <span className="text-[11px]" style={{ color: estado === "erro" ? "var(--status-critical)" : "var(--status-good)" }}>
                {mensagem}
              </span>
            )}
          </div>
        )}
        <p className="pt-1 text-[10px] text-[var(--text-muted)]">
          Aprovar registra a decisão no histórico — nunca executa a transferência. A peça só se move quando a equipe move.
        </p>
      </div>
    </div>
  );
}

export function MovimentacoesTable({
  movimentacoes,
  manter,
  totalAntesDoFiltro,
  podeDecidir,
}: {
  movimentacoes: MovimentacaoRecomendada[];
  manter: RecomendacaoManter[];
  totalAntesDoFiltro: number;
  podeDecidir: boolean;
}) {
  const [aberta, setAberta] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gridline)] px-4 py-2.5">
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">
            Movimentações recomendadas ({formatNumero(movimentacoes.length)}
            {movimentacoes.length !== totalAntesDoFiltro ? ` de ${formatNumero(totalAntesDoFiltro)}` : ""})
          </h2>
          <span className="text-xs text-[var(--text-muted)]">Clique numa linha pra abrir o detalhe</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] text-left text-[var(--text-muted)]">
                <th className="px-3 py-1.5 font-medium whitespace-nowrap">Produto</th>
                <th className="px-3 py-1.5 font-medium whitespace-nowrap">Origem</th>
                <th className="px-3 py-1.5 font-medium whitespace-nowrap">Destino</th>
                <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Qtd.</th>
                <th className="px-3 py-1.5 font-medium whitespace-nowrap">Prioridade</th>
                <th className="px-3 py-1.5 font-medium whitespace-nowrap">Tipo</th>
                <th className="px-3 py-1.5 font-medium whitespace-nowrap">Classificação</th>
                <th className="px-3 py-1.5 font-medium">Justificativa</th>
              </tr>
            </thead>
            <tbody>
              {movimentacoes.map((m, i) => {
                const id = `${m.cod}-${m.origemPosicaoId}-${m.destinoPosicaoId}-${i}`;
                const cls = classificacaoInfo(m.classificacao);
                const pri = prioridadeInfo(m.prioridade);
                const conf = confiancaInfo(m.confianca);
                const estaAberta = aberta === id;
                return (
                  <Fragment key={id}>
                    <tr
                      className="cursor-pointer border-b border-[var(--gridline)] hover:bg-[var(--page-plane)]"
                      onClick={() => setAberta(estaAberta ? null : id)}
                      aria-expanded={estaAberta}
                      data-testid="movimentacao-linha"
                    >
                      <td className="px-3 py-1.5 text-[var(--text-primary)]">
                        <span aria-hidden className="mr-1 inline-block text-[var(--text-muted)]">
                          {estaAberta ? "▾" : "▸"}
                        </span>
                        {m.produto}
                        <span className="text-[var(--text-muted)]">
                          {m.cor ? ` · ${m.cor}` : ""}
                          {m.tamanho ? ` · ${m.tamanho}` : ""} ({m.cod})
                        </span>
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-secondary)]">{m.origemNome}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-secondary)]">{m.destinoNome}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium text-[var(--text-primary)]">
                        {formatNumero(m.quantidadeSugerida)}
                      </td>
                      <td className="px-3 py-1.5">
                        <Badge color={pri.color}>{pri.label}</Badge>
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-secondary)]">{TIPO_LABEL[m.tipoMovimentacao]}</td>
                      <td className="px-3 py-1.5">
                        <span className="inline-flex flex-wrap items-center gap-1">
                          <Badge color={cls.color} title={cls.descricao}>
                            {cls.label}
                          </Badge>
                          {m.confianca !== "alta" && (
                            <Badge color={conf.color} title={m.avisos.join(" ")}>
                              {m.confianca === "baixa" ? "Baixa confiança" : "Conf. média"}
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className="max-w-[28rem] px-3 py-1.5 text-[var(--text-muted)]">
                        <span className="line-clamp-2">{m.justificativa[0]}</span>
                      </td>
                    </tr>
                    {estaAberta && (
                      <tr className="border-b border-[var(--gridline)]">
                        <td colSpan={8} className="p-0">
                          <DetalheLinha m={m} podeDecidir={podeDecidir} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {movimentacoes.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-[var(--text-muted)]">
                    Nenhuma movimentação recomendada no filtro atual — nada com excesso numa posição e falta real em
                    outra, e nenhuma peça com sinais suficientes pra recolhimento.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {manter.length > 0 && (
        <details className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)]">
            MANTER — aparente excesso com justificativa comercial pra não mover ({formatNumero(manter.length)})
          </summary>
          <div className="overflow-x-auto border-t border-[var(--gridline)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] text-left text-[var(--text-muted)]">
                  <th className="px-3 py-1.5 font-medium whitespace-nowrap">Produto</th>
                  <th className="px-3 py-1.5 font-medium whitespace-nowrap">Unidade</th>
                  <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Estoque</th>
                  <th className="px-3 py-1.5 font-medium whitespace-nowrap">Diagnóstico</th>
                  <th className="px-3 py-1.5 font-medium">Por que não mover</th>
                </tr>
              </thead>
              <tbody>
                {manter.slice(0, 300).map((k, i) => {
                  const info = diagnosticoInfo(k.diagnostico);
                  return (
                    <tr key={`${k.cod}-${k.posicaoId}-${i}`} className="border-b border-[var(--gridline)] last:border-0">
                      <td className="px-3 py-1.5 text-[var(--text-primary)]">
                        {k.produto}
                        <span className="text-[var(--text-muted)]">
                          {k.cor ? ` · ${k.cor}` : ""}
                          {k.tamanho ? ` · ${k.tamanho}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-secondary)]">{k.posicaoNome}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-secondary)]">{formatNumero(k.estoqueAtual)}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: info.color }} />
                          {info.label}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-[var(--text-muted)]">{k.motivo.join(" ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {manter.length > 300 && (
              <p className="px-3 py-2 text-xs text-[var(--text-muted)]">
                Mostrando as 300 primeiras de {formatNumero(manter.length)} — refine o filtro pra ver o resto.
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
