import Link from "next/link";
import {
  detalharProjecaoGrupo,
  backtestGrupo,
  getReceitaLiquidaPorGrupoMes,
  getMomentumPorGrupo,
  nomeCenario,
  type PremissasCrescimento,
} from "@/lib/metrics";
import { formatMoeda, formatNumero, formatPct } from "./inteligencia/format";

// Detalhamento da Projeção (seção 12 do briefing: "não quero uma caixa preta") — server-rendered,
// mostrado quando ?detalheGrupo=&detalheMes= estão presentes na URL (em vez de um client fetch —
// consistente com o resto do app, que é inteiramente server-rendered por searchParams). O link
// "Fechar" simplesmente remove esses 2 params preservando o resto.
export async function DetalhamentoModal({
  grupo,
  mes,
  premissas,
  fecharHref,
}: {
  grupo: string;
  mes: string;
  premissas: PremissasCrescimento;
  fecharHref: string;
}) {
  const hoje = new Date();
  const [y, m] = mes.split("-").map(Number);
  const mesAnoAnterior = `${y - 1}-${String(m).padStart(2, "0")}`;

  const [momentumMap, receitaPorGrupoMes] = await Promise.all([
    getMomentumPorGrupo([grupo], hoje),
    getReceitaLiquidaPorGrupoMes([grupo], new Date(y - 2, 0, 1), new Date(y + 1, 11, 31)),
  ]);
  const momentum = momentumMap.get(grupo) ?? 1;
  const baseComparavel = receitaPorGrupoMes.get(grupo)?.get(mesAnoAnterior) ?? 0;

  const detalhe = detalharProjecaoGrupo(premissas, { grupo, mes, baseComparavel, momentum });

  // Backtest (seção 13) — últimos 6 meses JÁ REALIZADOS (antes do mês atual), reaplicando a MESMA
  // fórmula sobre o histórico real.
  const receitaMap = receitaPorGrupoMes.get(grupo) ?? new Map<string, number>();
  const mesesOrdenados = [...receitaMap.keys()].sort();
  const mesAtualStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const mesesRealizados = mesesOrdenados.filter((mm) => mm < mesAtualStr).slice(-6);
  const pontosBacktest = mesesRealizados
    .map((mm) => {
      const [yy, mmNum] = mm.split("-").map(Number);
      const mmAnoAnterior = `${yy - 1}-${String(mmNum).padStart(2, "0")}`;
      const base = receitaMap.get(mmAnoAnterior);
      if (base == null) return null;
      return { grupo, mes: mm, baseComparavel: base, momentum, realizado: receitaMap.get(mm) ?? 0 };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const backtest = backtestGrupo(premissas, pontosBacktest);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <Link href={fecharHref} className="absolute inset-0 bg-black/60" aria-label="Fechar" />
      <div className="relative max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-1)] px-5 py-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Detalhamento da Projeção — {grupo} · {mes}
          </h2>
          <Link href={fecharHref} className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--page-plane)] hover:text-[var(--text-primary)]">
            ✕
          </Link>
        </div>
        <div className="p-5">
          <p className="mb-4 text-xs text-[var(--text-muted)]">
            A sazonalidade já está embutida na base comparável (o mesmo mês, um ano atrás) — o momentum abaixo reflete só a tendência recente real,
            independente da sazonalidade.
          </p>
          <div className="space-y-2">
            <Linha label="Base comparável (mesmo mês, ano anterior)" valor={`${formatMoeda(detalhe.baseComparavel)}`} />
            <Linha label="Cenário selecionado" valor={`${nomeCenario(detalhe.cenario)} (${formatPct(detalhe.presetCenario)}/ano de referência)`} />
            <Linha label="Ajuste do grupo" valor={`×${detalhe.ajusteGrupo.toFixed(2)}`} />
            <Linha label="Ajuste manual do mês" valor={`${detalhe.ajusteMensalPontos >= 0 ? "+" : ""}${detalhe.ajusteMensalPontos.toFixed(1)} pontos`} />
            <Linha label="Crescimento efetivo aplicado" valor={formatPct(detalhe.crescimentoEfetivo * 100)} />
            <Linha label="Ajuste de momentum (tendência recente)" valor={`×${detalhe.momentum.toFixed(3)}`} />
            <div className="flex items-center justify-between rounded-md px-3 py-2.5" style={{ background: "color-mix(in srgb, var(--series-1) 14%, transparent)" }}>
              <span className="text-sm font-semibold text-[var(--text-primary)]">Resultado projetado</span>
              <span className="text-lg font-bold text-[var(--text-primary)]">{formatMoeda(detalhe.resultado)}</span>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Backtest — últimos {backtest.length} mês(es) realizados
            </h3>
            <p className="mb-2 text-[11px] text-[var(--text-muted)]">
              Refaz a projeção de meses JÁ REALIZADOS com a mesma fórmula e compara com o que de fato aconteceu. Útil pra calibrar premissas, não é uma
              métrica de acurácia certificada.
            </p>
            {backtest.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">Sem histórico suficiente (2 anos) para backtest deste grupo.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--text-muted)]">
                    <th className="pb-1 font-normal">Mês</th>
                    <th className="pb-1 text-right font-normal">Previsto</th>
                    <th className="pb-1 text-right font-normal">Realizado</th>
                    <th className="pb-1 text-right font-normal">Erro %</th>
                  </tr>
                </thead>
                <tbody>
                  {backtest.map((p) => (
                    <tr key={p.mes} className="border-t border-[var(--gridline)]">
                      <td className="py-1 text-[var(--text-primary)]">{p.mes}</td>
                      <td className="py-1 text-right tabular-nums text-[var(--text-secondary)]">{formatMoeda(p.previsto)}</td>
                      <td className="py-1 text-right tabular-nums text-[var(--text-secondary)]">{formatMoeda(p.realizado)}</td>
                      <td
                        className="py-1 text-right tabular-nums font-medium"
                        style={{ color: p.erroPct == null || Math.abs(p.erroPct) < 0.15 ? "var(--status-good)" : "var(--status-warning)" }}
                      >
                        {p.erroPct != null ? `${p.erroPct >= 0 ? "+" : ""}${formatPct(p.erroPct * 100)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Linha({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--gridline)] py-2 text-sm">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className="font-medium tabular-nums text-[var(--text-primary)]">{valor}</span>
    </div>
  );
}
