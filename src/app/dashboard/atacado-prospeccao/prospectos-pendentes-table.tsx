import type { ProspectoPendente } from "@/lib/metrics/prospeccao-qualificacao";
import { parseScoreDetalhe, parseEvidenciasQualificacao } from "@/lib/metrics/prospeccao-qualificacao";
import {
  CLASSIFICACAO_LABEL,
  CLASSIFICACAO_BADGE_CLASS,
  CRITERIO_GATE_LABEL,
  RESULTADO_CRITERIO_LABEL,
  RESULTADO_ELIMINACAO_LABEL,
} from "./qualificacao-labels";

// Deliberadamente num bloco visual separado (borda/fundo âmbar) do de aprovados — nunca misturar
// "ainda não decidido" com "liberado pra contato comercial" (motor-qualificacao.ts: só promoção
// manual depois de revisão vira APROVADO; nenhum script promove isso sozinho). Sem controles de
// estágio comercial aqui de propósito: não faz sentido rastrear follow-up de quem ainda não foi
// aprovado pra contato.
export function ProspectosPendentesTable({ prospects }: { prospects: ProspectoPendente[] }) {
  return (
    <section data-testid="qualificacao-pendentes" className="overflow-hidden rounded-lg border border-amber-500/40 bg-amber-500/[0.04]">
      <div className="border-b border-amber-500/30 px-4 py-3">
        <h3 className="text-sm font-semibold text-amber-800">Pendentes de revisão humana ({prospects.length})</h3>
        <p className="mt-1 text-xs text-amber-700/80">Passaram no gate automático (ou ficaram inconclusivos), mas ainda não foram promovidos por uma pessoa. Não estão liberados para contato comercial.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-amber-700/70">
            <tr>
              <th className="px-4 py-3 font-medium">Loja</th>
              <th className="px-4 py-3 font-medium">Classificação candidata</th>
              <th className="px-4 py-3 font-medium">Localização</th>
              <th className="px-4 py-3 font-medium">Marcas identificadas</th>
              <th className="px-4 py-3 font-medium">Evidências coletadas</th>
              <th className="px-4 py-3 font-medium">Atualizado</th>
            </tr>
          </thead>
          <tbody>
            {prospects.map((p) => {
              const score = parseScoreDetalhe(p.scoreDetalhe);
              const evidencias = parseEvidenciasQualificacao(p.evidenciasQualificacao);
              return (
                <tr key={p.id} className="border-t border-amber-500/20 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.nomeFantasia}</div>
                    {p.cnpj && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{p.cnpj}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {p.classificacaoProspect ? (
                      <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${CLASSIFICACAO_BADGE_CLASS[p.classificacaoProspect] ?? ""}`}>
                        {CLASSIFICACAO_LABEL[p.classificacaoProspect] ?? p.classificacaoProspect}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-700/80">Aguardando pontuação</span>
                    )}
                    {score && <div className="mt-1 text-[11px] text-amber-700/70">{score.total}/100 (candidato, não final)</div>}
                    {p.resultadoEliminacao && (
                      <div className="mt-1 text-[10px] text-amber-700/70">{RESULTADO_ELIMINACAO_LABEL[p.resultadoEliminacao] ?? p.resultadoEliminacao}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                    <div>{[p.cidade, p.estado].filter(Boolean).join(" / ") || "Não identificado"}</div>
                    {p.cidade && (
                      <span className="mt-1 inline-flex rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                        {p.capitalEstadual ? "Capital" : "Interior"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {p.brands.length === 0 ? (
                      <span className="text-xs text-amber-700/70">Nenhuma ainda</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-xs font-medium underline">{p.brands.length} marca{p.brands.length > 1 ? "s" : ""}</summary>
                        <ul className="mt-2 max-w-56 space-y-1 text-[10px] text-[var(--text-muted)]">
                          {p.brands.map((brand) => <li key={brand.id}>{brand.marca} — {brand.evidencia}</li>)}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {!evidencias ? (
                      <span className="text-amber-700/70">Sem detalhamento disponível</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-amber-800 underline">Ver critérios</summary>
                        <ul className="mt-2 max-w-64 space-y-1 text-[10px] text-[var(--text-muted)]">
                          {evidencias.criterios.map((c) => (
                            <li key={c.id}>
                              <span className="font-medium text-[var(--text-secondary)]">{CRITERIO_GATE_LABEL[c.id] ?? c.id}:</span>{" "}
                              {RESULTADO_CRITERIO_LABEL[c.resultado] ?? c.resultado}
                              {c.motivo && <div>{c.motivo}</div>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--text-muted)]">{p.updatedAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                </tr>
              );
            })}
            {prospects.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-amber-700/70">
                  Nenhum candidato pendente de revisão no momento.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
