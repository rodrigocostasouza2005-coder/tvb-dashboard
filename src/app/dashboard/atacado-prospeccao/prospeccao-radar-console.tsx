import Link from "next/link";

type Props = {
  total: number;
  novos: number;
  emPesquisa: number;
  qualificados: number;
  contatados: number;
};

const number = (value: number) => value.toLocaleString("pt-BR");

export function ProspeccaoRadarConsole({
  total,
  novos,
  emPesquisa,
  qualificados,
  contatados,
}: Props) {
  const stages = [
    { name: "Captura externa", detail: "27 UFs · bucket pendente", state: "pending" },
    { name: "Deduplicação", detail: "Etapa ainda não executada", state: "pending" },
    { name: "Pesquisa cadastral", detail: number(emPesquisa) + " em fila", state: emPesquisa ? "active" : "idle" },
    { name: "Pesquisa comercial", detail: "Agente de pesquisa ainda não ativado", state: "pending" },
    { name: "Revisão humana", detail: "Aprovação manual obrigatória", state: "pending" },
    { name: "Radar", detail: "Somente aprovados entram", state: "locked" },
  ] as const;

  const metrics = [
    { label: "PROSPECTOS NA CARTEIRA", value: total, note: "Registros operacionais" },
    { label: "NOVOS", value: novos, note: "Aguardando triagem" },
    { label: "EM QUALIFICAÇÃO", value: emPesquisa, note: "Validação cadastral" },
    { label: "QUALIFICADOS", value: qualificados, note: "Perfil revisado" },
    { label: "CONTATADOS", value: contatados, note: "Acompanhamento comercial" },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] pb-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            RADAR / ATACADO / PROSPECÇÃO
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Central de Prospecção</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Captura, validação comercial e aprovação de novos lojistas.</p>
        </div>
        <Link href="/dashboard/atacado" className="border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:border-amber-500 hover:text-[var(--text-primary)]">
          ← Visão de Atacado
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-px overflow-hidden border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3 xl:grid-cols-5">
        {metrics.map((metric) => (
          <div key={metric.label} className="min-w-0 bg-[var(--surface-1)] px-4 py-3">
            <div className="truncate text-[9px] font-semibold tracking-[0.14em] text-[var(--text-muted)]">{metric.label}</div>
            <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[var(--text-primary)]">{number(metric.value)}</div>
            <div className="mt-1 text-[10px] text-[var(--text-muted)]">{metric.note}</div>
          </div>
        ))}
      </section>

      <section className="border border-[var(--border)] bg-[var(--surface-1)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-primary)]">Esteira de prospecção</h2>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">Separação explícita entre captura cadastral e aprovação comercial.</p>
          </div>
          <span className="border border-amber-500/40 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-amber-600">Operação controlada</span>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--border)] md:grid-cols-3 xl:grid-cols-6 xl:divide-y-0">
          {stages.map((stage, index) => (
            <div key={stage.name} className="min-w-0 px-3 py-3">
              <div className="flex items-center gap-2">
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center border text-[10px] font-mono ${stage.state === "active" ? "border-amber-500 bg-amber-500/10 text-amber-600" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
                  {stage.state === "active" ? "•" : String(index + 1).padStart(2, "0")}
                </span>
                <span className="truncate text-[11px] font-semibold text-[var(--text-primary)]">{stage.name}</span>
              </div>
              <p className="mt-2 min-h-8 text-[10px] leading-4 text-[var(--text-muted)]">{stage.detail}</p>
              <div className={`mt-2 h-px w-full ${stage.state === "active" ? "bg-amber-500" : "bg-[var(--border)]"}`} />
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="border border-[var(--border)] bg-[var(--surface-1)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em]">Fila operacional</h2>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">Dados reais da carteira cadastrada no Radar</p>
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
          <div className="border-t border-[var(--border)] px-4 py-3 text-[10px] text-[var(--text-muted)]">
            A tabela detalhada, filtros, cadastro manual e histórico continuam disponíveis logo abaixo.
          </div>
        </section>

        <aside className="border border-[var(--border)] bg-[var(--surface-1)]">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em]">Controles da operação</h2>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">Regras que não podem ser ignoradas</p>
          </div>
          <ul className="divide-y divide-[var(--border)] px-4">
            {[
              "CNAE não confirma perfil multimarcas",
              "Pesquisa comercial exige evidências",
              "Base bruta fica fora do Neon",
              "Nenhum contato automático",
              "Bruce acompanha após atribuição",
              "Conversão exige primeiro pedido no DAPIC",
            ].map((rule) => (
              <li key={rule} className="flex gap-2 py-2.5 text-[10px] leading-4 text-[var(--text-secondary)]">
                <span className="mt-0.5 text-amber-600">▸</span>{rule}
              </li>
            ))}
          </ul>
          <div className="border-t border-[var(--border)] px-4 py-3">
            <div className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Armazenamento externo</div>
            <div className="mt-1 text-xs font-semibold text-amber-600">Aguardando configuração</div>
            <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">Bucket e credenciais S3 ainda precisam ser configurados no GitHub Actions.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
