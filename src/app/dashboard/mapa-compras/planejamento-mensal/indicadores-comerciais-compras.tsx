import Link from "next/link";
import type { MapaComprasGrupo } from "@/lib/metrics";
import { formatMoeda, formatNumero } from "../inteligencia/format";

// Grupos de indicadores "Comercial" e "Compras" (seções 6.4/6.5 do briefing) — aditivo à matriz
// Estoque/Compras já existente (MatrizCompras, NÃO alterada aqui). Usa receitaPorMes/leadTimeDias
// que getMapaDeComprasDetalhado já calcula e expõe em cada MapaComprasGrupo (sem 2ª query).
export function IndicadoresComerciaisCompras({
  grupos,
  queryBase,
}: {
  grupos: MapaComprasGrupo[];
  // searchParams atuais (serializados), pra o link de detalhamento preservar todos os filtros
  // ativos — nunca reseta a tela ao abrir o modal.
  queryBase: Record<string, string | string[] | undefined>;
}) {
  if (grupos.length === 0) return null;

  function linkDetalhe(grupo: string, mes: string): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(queryBase)) {
      if (typeof v === "string") params.set(k, v);
      else if (Array.isArray(v)) for (const vv of v) params.append(k, vv);
    }
    params.set("detalheGrupo", grupo);
    params.set("detalheMes", mes);
    return `/dashboard/mapa-compras?${params.toString()}`;
  }

  return (
    <details className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)]">
        Indicadores Comerciais e de Compra (por grupo)
      </summary>
      <div className="flex flex-col gap-4 border-t border-[var(--border)] p-4">
        {grupos.map((g) => {
          const receita = g.receitaPorMes ?? {};
          const meses = g.meses;
          const faturamentoAnoAnterior = (mes: string) => {
            const [y, m] = mes.split("-").map(Number);
            const anoAnterior = `${y - 1}-${String(m).padStart(2, "0")}`;
            return receita[anoAnterior];
          };
          return (
            <div key={g.grupo}>
              <h3 className="mb-1.5 text-xs font-semibold text-[var(--text-primary)]">{g.grupo}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-[var(--text-muted)]">
                      <th className="sticky left-0 z-10 bg-[var(--surface-1)] py-1 pr-3 font-medium">Indicador</th>
                      {meses.map((m) => (
                        <th
                          key={m.mes}
                          className="py-1 px-2 text-right font-medium"
                          style={{ color: m.tipo === "projetado" ? "var(--series-1)" : "var(--text-muted)" }}
                        >
                          {m.mes}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-[var(--gridline)]">
                      <td className="sticky left-0 z-10 bg-[var(--surface-1)] py-1 pr-3 text-[var(--text-secondary)]">Faturamento</td>
                      {meses.map((m) => {
                        const valor = receita[m.mes] ?? 0;
                        const clicavel = m.tipo === "projetado";
                        return (
                          <td key={m.mes} className="py-1 px-2 text-right tabular-nums">
                            {clicavel ? (
                              <Link
                                href={linkDetalhe(g.grupo, m.mes)}
                                className="text-[var(--series-1)] underline-offset-2 hover:underline"
                                title="Ver detalhamento da projeção"
                              >
                                {formatMoeda(valor)}
                              </Link>
                            ) : (
                              <span className="text-[var(--text-secondary)]">{formatMoeda(valor)}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    <tr className="border-t border-[var(--gridline)]">
                      <td className="sticky left-0 z-10 bg-[var(--surface-1)] py-1 pr-3 text-[var(--text-secondary)]">Faturamento Ano Anterior</td>
                      {meses.map((m) => (
                        <td key={m.mes} className="py-1 px-2 text-right tabular-nums text-[var(--text-muted)]">
                          {faturamentoAnoAnterior(m.mes) != null ? formatMoeda(faturamentoAnoAnterior(m.mes)!) : "—"}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-t border-[var(--gridline)]">
                      <td className="sticky left-0 z-10 bg-[var(--surface-1)] py-1 pr-3 text-[var(--text-secondary)]">Crescimento %</td>
                      {meses.map((m) => {
                        const atual = receita[m.mes] ?? 0;
                        const anterior = faturamentoAnoAnterior(m.mes);
                        const pct = anterior && anterior > 0 ? (atual / anterior - 1) * 100 : null;
                        return (
                          <td
                            key={m.mes}
                            className="py-1 px-2 text-right tabular-nums"
                            style={{ color: pct == null ? "var(--text-muted)" : pct >= 0 ? "var(--status-good)" : "var(--status-critical)" }}
                          >
                            {pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%` : "—"}
                          </td>
                        );
                      })}
                    </tr>
                    <tr className="border-t border-[var(--gridline)]">
                      <td className="sticky left-0 z-10 bg-[var(--surface-1)] py-1 pr-3 font-semibold text-[var(--text-primary)]">Necessidade de Compra</td>
                      {meses.map((m) => (
                        <td key={m.mes} className="py-1 px-2 text-right tabular-nums font-semibold" style={{ color: m.faltaComprar > 0 ? "var(--status-warning)" : "var(--status-good)" }}>
                          {formatNumero(m.faltaComprar)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-t border-[var(--gridline)]">
                      <td className="sticky left-0 z-10 bg-[var(--surface-1)] py-1 pr-3 text-[var(--text-secondary)]">Lead Time (dias)</td>
                      {meses.map((m) => (
                        <td key={m.mes} className="py-1 px-2 text-right tabular-nums text-[var(--text-muted)]">
                          {g.leadTimeDias ?? "—"}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
      <p className="px-4 pb-3 text-[11px] text-[var(--text-muted)]">
        Clique num valor de Faturamento projetado (azul) para ver o detalhamento da projeção — base histórica, crescimento, sazonalidade e momentum.
      </p>
    </details>
  );
}
