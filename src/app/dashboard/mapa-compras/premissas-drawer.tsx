import Link from "next/link";
import type { PremissasCrescimento, Cenario, PosicaoEstoque } from "@/lib/metrics";
import { nomeCenario, CENARIOS } from "@/lib/metrics";
import {
  setCenarioAtivoAction,
  setCenarioPresetAction,
  setAjusteLojaAction,
  setAjusteGrupoAction,
  setAjusteMensalAction,
} from "./actions";
import { formatPct } from "./inteligencia/format";
import { ActionForm } from "./action-form";

const MESES_LABEL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// Premissas de Crescimento (seções 8, 9, 10 do briefing) — drawer server-rendered, visibilidade
// controlada por ?premissas=1 na URL (consistente com o resto do app, que é 100% searchParams-
// driven — sem precisar de estado client só pra abrir/fechar). Cada edição é um <form> com Server
// Action própria (mesmo padrão de updateCrescimentoAction/updateCoberturaMetaAction já existentes
// nesta página) — revalida a página inteira, a matriz/Visão Analítica recalculam na hora.
export function PremissasDrawer({
  fecharHref,
  premissas,
  posicoes,
  grupos,
  canEdit,
}: {
  fecharHref: string;
  premissas: PremissasCrescimento;
  posicoes: PosicaoEstoque[];
  grupos: string[];
  canEdit: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <Link href={fecharHref} className="absolute inset-0 bg-black/60" aria-label="Fechar" />
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-[var(--border)] bg-[var(--surface-1)] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-1)] px-5 py-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Premissas de Projeção</h2>
          <Link href={fecharHref} className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--page-plane)] hover:text-[var(--text-primary)]">
            ✕
          </Link>
        </div>
        <div className="flex flex-col gap-6 p-5">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Cenário Ativo</h3>
            <div className="flex gap-2">
              {CENARIOS.map((c) => {
                const ativo = c === premissas.cenarioAtivo;
                return (
                  <ActionForm key={c} action={setCenarioAtivoAction} className="flex-1">
                    <input type="hidden" name="cenario" value={c} />
                    <button
                      type="submit"
                      disabled={!canEdit}
                      className="w-full rounded-md border px-3 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                      style={{
                        borderColor: ativo ? "var(--series-1)" : "var(--border)",
                        background: ativo ? "color-mix(in srgb, var(--series-1) 14%, transparent)" : undefined,
                      }}
                    >
                      <div className="font-semibold text-[var(--text-primary)]">{nomeCenario(c)}</div>
                      <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{formatPct(premissas.presets[c])}/ano</div>
                    </button>
                  </ActionForm>
                );
              })}
            </div>
            {canEdit && (
              <div className="mt-3 flex flex-col gap-2">
                {CENARIOS.map((c) => (
                  <ActionForm key={c} action={setCenarioPresetAction} className="flex items-center gap-2 text-xs">
                    <input type="hidden" name="cenario" value={c} />
                    <span className="w-24 text-[var(--text-secondary)]">{nomeCenario(c)}</span>
                    <input
                      type="number"
                      name="crescimentoPct"
                      step={1}
                      defaultValue={premissas.presets[c]}
                      className="w-20 rounded border border-[var(--border)] bg-[var(--page-plane)] px-2 py-1 text-right text-[var(--text-primary)]"
                    />
                    <span className="text-[var(--text-muted)]">%/ano</span>
                    <button type="submit" className="rounded border border-[var(--border)] px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
                      Salvar
                    </button>
                  </ActionForm>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Crescimento por Loja</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--text-muted)]">
                  <th className="pb-1 font-normal">Loja</th>
                  <th className="pb-1 text-right font-normal">Multiplicador</th>
                  {canEdit && <th className="pb-1" />}
                </tr>
              </thead>
              <tbody>
                {posicoes.map((p) => (
                  <tr key={p.posicaoId} className="border-t border-[var(--gridline)]">
                    <td className="py-1.5 font-medium text-[var(--text-primary)]">{p.nome}</td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--text-secondary)]">×{(premissas.ajusteLoja[p.posicaoId] ?? 1).toFixed(2)}</td>
                    {canEdit && (
                      <td className="py-1.5 pl-2">
                        <ActionForm action={setAjusteLojaAction} className="flex items-center gap-1">
                          <input type="hidden" name="posicaoId" value={p.posicaoId} />
                          <input
                            type="number"
                            name="multiplicador"
                            step={0.05}
                            defaultValue={premissas.ajusteLoja[p.posicaoId] ?? 1}
                            className="w-16 rounded border border-[var(--border)] bg-[var(--page-plane)] px-1.5 py-1 text-right text-[var(--text-primary)]"
                          />
                          <button type="submit" className="rounded border border-[var(--border)] px-1.5 py-1 text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
                            OK
                          </button>
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Crescimento por Grupo</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--text-muted)]">
                  <th className="pb-1 font-normal">Grupo</th>
                  <th className="pb-1 text-right font-normal">Multiplicador</th>
                  {canEdit && <th className="pb-1" />}
                </tr>
              </thead>
              <tbody>
                {grupos.map((g) => (
                  <tr key={g} className="border-t border-[var(--gridline)]">
                    <td className="py-1.5 font-medium text-[var(--text-primary)]">{g}</td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--text-secondary)]">×{(premissas.ajusteGrupo[g] ?? 1).toFixed(2)}</td>
                    {canEdit && (
                      <td className="py-1.5 pl-2">
                        <ActionForm action={setAjusteGrupoAction} className="flex items-center gap-1">
                          <input type="hidden" name="grupo" value={g} />
                          <input
                            type="number"
                            name="multiplicador"
                            step={0.05}
                            defaultValue={premissas.ajusteGrupo[g] ?? 1}
                            className="w-16 rounded border border-[var(--border)] bg-[var(--page-plane)] px-1.5 py-1 text-right text-[var(--text-primary)]"
                          />
                          <button type="submit" className="rounded border border-[var(--border)] px-1.5 py-1 text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
                            OK
                          </button>
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {canEdit && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Ajuste Manual por Mês (opcional)</h3>
              <p className="mb-2 text-[11px] text-[var(--text-muted)]">Pontos percentuais somados ao crescimento efetivo daquele mês do calendário, todo ano.</p>
              <div className="grid grid-cols-4 gap-2">
                {MESES_LABEL.map((label, i) => {
                  const mesCalendario = i + 1;
                  return (
                    <ActionForm key={label} action={setAjusteMensalAction} className="flex flex-col gap-0.5">
                      <input type="hidden" name="mesCalendario" value={mesCalendario} />
                      <span className="text-[10px] text-[var(--text-muted)]">{label}</span>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          name="ajustePontos"
                          step={1}
                          defaultValue={premissas.ajusteMensal[mesCalendario] ?? 0}
                          className="w-full rounded border border-[var(--border)] bg-[var(--page-plane)] px-1.5 py-1 text-xs text-[var(--text-primary)]"
                        />
                        <button type="submit" className="rounded border border-[var(--border)] px-1.5 py-1 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]">
                          OK
                        </button>
                      </div>
                    </ActionForm>
                  );
                })}
              </div>
            </section>
          )}

          {!canEdit && (
            <p className="text-xs text-[var(--text-muted)]">Visualização somente leitura — só ADMIN/GESTÃO pode editar premissas de crescimento.</p>
          )}
        </div>
      </div>
    </div>
  );
}
