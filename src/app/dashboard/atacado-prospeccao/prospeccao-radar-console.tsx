import Link from "next/link";

type Props = {
  total: number;
  novos: number;
  emPesquisa: number;
  qualificados: number;
  contatados: number;
  descartados: number;
};

const number = (value: number) => value.toLocaleString("pt-BR");

// Cabeçalho + fila operacional do pipeline MANUAL de captação (campo legado `status`). Trimmed
// em 2026-11 (reformulação da aba): removida a "Esteira de prospecção" (estágios decorativos que
// só diziam "ainda não executado"/"configuração manual" sem nenhuma informação real) e o aside
// "Controles da operação" com nota de bucket S3 "aguardando configuração" — nenhum dos dois tinha
// aplicação prática, só ocupavam espaço. Também removida a grade de métricas que duplicava os
// mesmos 4 números da "Fila operacional" abaixo (pedido do Rodrigo: sem indicador repetido).
export function ProspeccaoRadarConsole({
  total,
  novos,
  emPesquisa,
  qualificados,
  contatados,
  descartados,
}: Props) {
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] pb-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            RADAR / ATACADO / PROSPECÇÃO
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Prospecção de clientes</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Identificação, avaliação e acompanhamento de potenciais lojistas B2B.</p>
        </div>
        <Link href="/dashboard/atacado" className="border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:border-amber-500 hover:text-[var(--text-primary)]">
          ← Visão de Atacado
        </Link>
      </header>

      <section className="border border-[var(--border)] bg-[var(--surface-1)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em]">Fila operacional (captação manual)</h2>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">Cadastro manual, importação CSV e descoberta web — ver seções abaixo</p>
          </div>
          <span className="font-mono text-xs tabular-nums text-[var(--text-muted)]">{number(total)} REG.</span>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <Link href="?status=NOVO" className="border border-[var(--border)] p-3 transition hover:border-amber-500">
            <div className="text-[9px] font-semibold tracking-widest text-[var(--text-muted)]">NOVOS</div>
            <div className="mt-1 font-mono text-xl tabular-nums">{number(novos)}</div>
            <div className="mt-1 text-[10px] text-[var(--text-muted)]">Abrir fila →</div>
          </Link>
          <Link href="?status=EM_QUALIFICACAO" className="border border-[var(--border)] p-3 transition hover:border-amber-500">
            <div className="text-[9px] font-semibold tracking-widest text-[var(--text-muted)]">EM PESQUISA</div>
            <div className="mt-1 font-mono text-xl tabular-nums">{number(emPesquisa)}</div>
            <div className="mt-1 text-[10px] text-[var(--text-muted)]">Abrir fila →</div>
          </Link>
          <Link href="?status=QUALIFICADO" className="border border-[var(--border)] p-3 transition hover:border-amber-500">
            <div className="text-[9px] font-semibold tracking-widest text-[var(--text-muted)]">QUALIFICADOS</div>
            <div className="mt-1 font-mono text-xl tabular-nums">{number(qualificados)}</div>
            <div className="mt-1 text-[10px] text-[var(--text-muted)]">Abrir fila →</div>
          </Link>
          <Link href="?status=CONTATADO" className="border border-[var(--border)] p-3 transition hover:border-amber-500">
            <div className="text-[9px] font-semibold tracking-widest text-[var(--text-muted)]">CONTATADOS</div>
            <div className="mt-1 font-mono text-xl tabular-nums">{number(contatados)}</div>
            <div className="mt-1 text-[10px] text-[var(--text-muted)]">Abrir fila →</div>
          </Link>
        </div>
        {/* Descartados ficam fora da fila operacional de propósito (pedido do Rodrigo, 2026-11-13:
            "não quero que o painel fique poluído por registros que já decidi descartar") — só
            acessível explicitamente aqui, nunca somado em nenhum indicador de oportunidade acima. */}
        <div className="border-t border-[var(--border)] px-4 py-2.5">
          <Link href="?status=DESCARTADO" className="inline-flex items-center gap-2 text-[11px] text-[var(--text-muted)] underline-offset-2 hover:underline">
            Visão administrativa: {number(descartados)} descartado(s) — fora da fila operacional, fora dos indicadores de oportunidade →
          </Link>
        </div>
      </section>
    </div>
  );
}
