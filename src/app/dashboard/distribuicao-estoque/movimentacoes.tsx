"use client";

import { Fragment, useState } from "react";
import type { MovimentacaoRecomendada, RecomendacaoManter, NecessidadeNaoAtendida } from "@/lib/metrics";
import {
  formatNumero,
  classificacaoInfo,
  prioridadeInfo,
  confiancaInfo,
  diagnosticoInfo,
} from "./format";
import { registrarDecisaoMovimentacaoAction } from "./actions";

// Aba 2 — Movimentações, em 4 áreas (pedido Rodrigo 2026-11-13): Abastecimento (CD/Site→loja +
// loja→loja, a mesma pergunta "quem cobre a necessidade da loja", só a origem muda — badge de
// prioridade na coluna Origem distingue as duas), Recolhimento (loja→CD/Site), Precisa de produção
// (necessidadesNaoAtendidas + manter.necessidadeReposicao, juntos só na apresentação, nunca no
// dado) e Mantido. Expansível no clique. Client component só por causa da expansão e do envio da
// decisão — os dados em si vêm prontos do servidor.
//
// Nada aqui executa movimentação física: "Aprovar" grava a DECISÃO humana sobre a recomendação
// (DecisaoMovimentacaoEstoque), que é o que a equipe usa pra acompanhar o que foi feito. A peça só
// se move quando alguém move, fora do Radar.

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

// Badge de origem só pras áreas de abastecimento/recolhimento — prioridadeOrigem só existe pro
// Passo 1/2 da hierarquia (CD/Site=1, Loja=2); recolhimento (loja→CD/Site) não tem prioridade de
// origem (é outra direção, fora da hierarquia CD→lojas→produção), então a badge não aparece ali.
function BadgeOrigem({ prioridadeOrigem }: { prioridadeOrigem?: 1 | 2 }) {
  if (!prioridadeOrigem) return null;
  return prioridadeOrigem === 1 ? (
    <Badge color="var(--series-1)" title="CD/Site é sempre a prioridade 1 de abastecimento">
      CD/Site
    </Badge>
  ) : (
    <Badge color="var(--text-muted)" title="Loja com excedente, só cobrindo o que o CD/Site não atendeu">
      Loja
    </Badge>
  );
}

function BadgeProducao({ info }: { info?: { quantidade: number; cobertura: "parcial" | "total" } }) {
  if (!info) return null;
  return (
    <Badge
      color={info.cobertura === "total" ? "var(--status-good)" : "var(--status-warning)"}
      title="Produção em andamento (ProductionOrder) — não é estoque físico disponível, só informa que já existe pedido feito"
    >
      Produção em andamento: {formatNumero(info.quantidade)} un. ({info.cobertura === "total" ? "cobre tudo" : "cobertura parcial"})
    </Badge>
  );
}

// Tabela reaproveitada pelas 2 áreas de transferência (Abastecimento e Recolhimento) — mesmas
// colunas, só filtra a lista de entrada e o texto do cabeçalho mudam por área.
function SecaoMovimentacoes({
  titulo,
  subtitulo,
  movimentacoes,
  podeDecidir,
  mostrarPrioridadeOrigem,
  idPrefixo,
  aberta,
  setAberta,
  vazio,
}: {
  titulo: string;
  subtitulo?: string;
  movimentacoes: MovimentacaoRecomendada[];
  podeDecidir: boolean;
  mostrarPrioridadeOrigem: boolean;
  idPrefixo: string;
  aberta: string | null;
  setAberta: (id: string | null) => void;
  vazio: string;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gridline)] px-4 py-2.5">
        <div>
          <h2 className="text-sm font-medium text-[var(--text-secondary)]">
            {titulo} ({formatNumero(movimentacoes.length)})
          </h2>
          {subtitulo && <p className="text-xs text-[var(--text-muted)]">{subtitulo}</p>}
        </div>
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
              <th className="px-3 py-1.5 font-medium whitespace-nowrap">Classificação</th>
              <th className="px-3 py-1.5 font-medium">Justificativa</th>
            </tr>
          </thead>
          <tbody>
            {movimentacoes.map((m, i) => {
              const id = `${idPrefixo}-${m.cod}-${m.origemPosicaoId}-${m.destinoPosicaoId}-${i}`;
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
                    <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-secondary)]">
                      <span className="inline-flex items-center gap-1.5">
                        {mostrarPrioridadeOrigem && <BadgeOrigem prioridadeOrigem={m.prioridadeOrigem} />}
                        {m.origemNome}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-secondary)]">{m.destinoNome}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium text-[var(--text-primary)]">
                      {formatNumero(m.quantidadeSugerida)}
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge color={pri.color}>{pri.label}</Badge>
                    </td>
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
                      <td colSpan={7} className="p-0">
                        <DetalheLinha m={m} podeDecidir={podeDecidir} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {movimentacoes.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-[var(--text-muted)]">
                  {vazio}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MovimentacoesTable({
  movimentacoes,
  manter,
  necessidadesNaoAtendidas,
  totalAntesDoFiltro,
  podeDecidir,
}: {
  movimentacoes: MovimentacaoRecomendada[];
  manter: RecomendacaoManter[];
  necessidadesNaoAtendidas: NecessidadeNaoAtendida[];
  totalAntesDoFiltro: number;
  podeDecidir: boolean;
}) {
  const [aberta, setAberta] = useState<string | null>(null);

  // Abastecimento junta CD/Site→loja (prioridade 1) e loja→loja (prioridade 2, só o residual que o
  // CD não cobriu) — as duas são "cobrir a necessidade de uma loja", só a origem muda; a badge de
  // prioridade na coluna Origem já deixa claro qual é qual.
  const abastecimento = movimentacoes.filter((m) => m.tipoMovimentacao !== "loja_cd_site");
  const recolhimento = movimentacoes.filter((m) => m.tipoMovimentacao === "loja_cd_site");
  const precisaProducao = manter.filter((k) => k.necessidadeReposicao);
  const mantido = manter.filter((k) => !k.necessidadeReposicao);
  const totalFiltrado = abastecimento.length + recolhimento.length;

  return (
    <div className="space-y-4">
      {totalFiltrado !== totalAntesDoFiltro && (
        <p className="text-xs text-[var(--text-muted)]">
          Mostrando {formatNumero(totalFiltrado)} de {formatNumero(totalAntesDoFiltro)} movimentações no filtro atual.
        </p>
      )}

      <SecaoMovimentacoes
        titulo="Abastecimento — CD/Site e lojas cobrindo necessidade"
        subtitulo="CD/Site é sempre tentado primeiro; loja só complementa o que sobrou depois do CD/Site."
        movimentacoes={abastecimento}
        podeDecidir={podeDecidir}
        mostrarPrioridadeOrigem
        idPrefixo="abast"
        aberta={aberta}
        setAberta={setAberta}
        vazio="Nenhuma necessidade de loja sem cobertura no filtro atual."
      />

      <SecaoMovimentacoes
        titulo="Recolhimento — lojas para CD/Site"
        subtitulo="Só quando há venda real comprovada no site nos últimos 90 dias — vender bem na loja física, por si só, nunca justifica recolher."
        movimentacoes={recolhimento}
        podeDecidir={podeDecidir}
        mostrarPrioridadeOrigem={false}
        idPrefixo="recol"
        aberta={aberta}
        setAberta={setAberta}
        vazio="Nenhum recolhimento recomendado no filtro atual."
      />

      {(necessidadesNaoAtendidas.length > 0 || precisaProducao.length > 0) && (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="border-b border-[var(--gridline)] px-4 py-2.5">
            <h2 className="text-sm font-medium text-[var(--text-secondary)]">
              Precisa de produção ({formatNumero(necessidadesNaoAtendidas.length + precisaProducao.length)})
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Nem CD/Site nem outra loja conseguem cobrir — nunca inventa disponibilidade futura, só sinaliza.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] text-left text-[var(--text-muted)]">
                  <th className="px-3 py-1.5 font-medium whitespace-nowrap">Produto</th>
                  <th className="px-3 py-1.5 font-medium whitespace-nowrap">Posição</th>
                  <th className="px-3 py-1.5 font-medium whitespace-nowrap">Origem do sinal</th>
                  <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Necessidade</th>
                  <th className="px-3 py-1.5 font-medium whitespace-nowrap">Diagnóstico</th>
                  <th className="px-3 py-1.5 font-medium">Produção em andamento</th>
                </tr>
              </thead>
              <tbody>
                {necessidadesNaoAtendidas.map((n, i) => {
                  const info = diagnosticoInfo(n.diagnostico);
                  return (
                    <tr key={`nna-${n.cod}-${n.posicaoId}-${i}`} className="border-b border-[var(--gridline)] last:border-0">
                      <td className="px-3 py-1.5 text-[var(--text-primary)]">
                        {n.produto}
                        <span className="text-[var(--text-muted)]">
                          {n.cor ? ` · ${n.cor}` : ""}
                          {n.tamanho ? ` · ${n.tamanho}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-secondary)]">{n.posicaoNome}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-secondary)]">Necessidade de loja sem cobertura</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium text-[var(--text-primary)]">
                        {formatNumero(n.necessidadeRestante)}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: info.color }} />
                          {info.label}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <BadgeProducao info={n.producaoEmAndamento} />
                      </td>
                    </tr>
                  );
                })}
                {precisaProducao.map((k, i) => {
                  const info = diagnosticoInfo(k.diagnostico);
                  return (
                    <tr key={`manter-prod-${k.cod}-${k.posicaoId}-${i}`} className="border-b border-[var(--gridline)] last:border-0">
                      <td className="px-3 py-1.5 text-[var(--text-primary)]">
                        {k.produto}
                        <span className="text-[var(--text-muted)]">
                          {k.cor ? ` · ${k.cor}` : ""}
                          {k.tamanho ? ` · ${k.tamanho}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-secondary)]">{k.posicaoNome}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-secondary)]">CD/Site sem estoque</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[var(--text-muted)]">—</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: info.color }} />
                          {info.label}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <BadgeProducao info={k.producaoEmAndamento} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {mantido.length > 0 && (
        <details className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)]">
            Mantido — sem ação recomendada ({formatNumero(mantido.length)})
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
                {mantido.slice(0, 300).map((k, i) => {
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
            {mantido.length > 300 && (
              <p className="px-3 py-2 text-xs text-[var(--text-muted)]">
                Mostrando as 300 primeiras de {formatNumero(mantido.length)} — refine o filtro pra ver o resto.
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
