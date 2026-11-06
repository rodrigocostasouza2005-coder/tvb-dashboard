import type { ProspectoAprovado } from "@/lib/metrics/prospeccao-qualificacao";
import { parseScoreDetalhe, parseEvidenciasQualificacao } from "@/lib/metrics/prospeccao-qualificacao";
import {
  CLASSIFICACAO_LABEL,
  CLASSIFICACAO_BADGE_CLASS,
  CONFIANCA_LABEL,
  CONFIANCA_BADGE_CLASS,
  TIPO_EVIDENCIA_MARCA_LABEL,
  TIPO_ESTABELECIMENTO_LABEL,
  CRITERIO_GATE_LABEL,
  RESULTADO_CRITERIO_LABEL,
  ESTAGIO_COMERCIAL_LABEL,
} from "./qualificacao-labels";
import { atualizarStatusProspectAction, registrarInteracaoBruceAction } from "./actions";

// Tabela principal da seção "Qualificação B2B" — só statusComercial === APROVADO. É aqui que
// moram as 9 capacidades centrais do pedido do Rodrigo: dados cadastrais, marcas identificadas,
// motivo de aprovação/evidência, prioridade e acompanhamento do estágio comercial (campo legado
// `status` + Bruce, reaproveitados sem duplicar lógica — ver actions.ts).
export function ProspectosAprovadosTable({ prospects }: { prospects: ProspectoAprovado[] }) {
  return (
    <section data-testid="qualificacao-aprovados" className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h3 className="text-sm font-semibold">Aprovados ({prospects.length})</h3>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Passaram no gate de elegibilidade e foram promovidos manualmente após revisão humana — únicos liberados para contato comercial.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Loja</th>
              <th className="px-4 py-3 font-medium">Prioridade</th>
              <th className="px-4 py-3 font-medium">Localização</th>
              <th className="px-4 py-3 font-medium">Marcas identificadas</th>
              <th className="px-4 py-3 font-medium">Motivo da aprovação</th>
              <th className="px-4 py-3 font-medium">Dados cadastrais</th>
              <th className="px-4 py-3 font-medium">Estágio comercial</th>
              <th className="px-4 py-3 font-medium">Atualizado</th>
            </tr>
          </thead>
          <tbody>
            {prospects.map((p) => {
              const score = parseScoreDetalhe(p.scoreDetalhe);
              const evidencias = parseEvidenciasQualificacao(p.evidenciasQualificacao);
              return (
                <tr key={p.id} className="border-t border-[var(--border)] align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.nomeFantasia}</div>
                    {p.razaoSocial && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{p.razaoSocial}</div>}
                    {p.cnpj && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{p.cnpj}</div>}
                    {p.tipoEstabelecimento && (
                      <span className="mt-1 inline-flex rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                        {TIPO_ESTABELECIMENTO_LABEL[p.tipoEstabelecimento] ?? p.tipoEstabelecimento}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {p.classificacaoProspect ? (
                      <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${CLASSIFICACAO_BADGE_CLASS[p.classificacaoProspect] ?? ""}`}>
                        {CLASSIFICACAO_LABEL[p.classificacaoProspect] ?? p.classificacaoProspect}
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">Sem classificação</span>
                    )}
                    {score && <div className="mt-1 text-[11px] text-[var(--text-muted)]">{score.total}/100</div>}
                    {score && score.subScores.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[10px] text-[var(--text-secondary)] underline">Ver avaliação</summary>
                        <ul className="mt-1 max-w-56 space-y-1 text-[10px] text-[var(--text-muted)]">
                          {score.subScores.map((s) => (
                            <li key={s.criterio}>
                              <span className="font-medium text-[var(--text-secondary)]">{s.criterio}</span> {s.pontos}/{s.maximo} — {s.rationale}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                    <div>{[p.cidade, p.estado].filter(Boolean).join(" / ") || "Não identificado"}</div>
                    {p.cidade && (
                      <span className={`mt-1 inline-flex rounded border px-1.5 py-0.5 text-[10px] ${p.capitalEstadual ? "border-[var(--series-1)]/40 text-[var(--series-1)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
                        {p.capitalEstadual ? "Capital" : "Interior"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {p.brands.length === 0 ? (
                      <span className="text-xs text-[var(--text-muted)]">Nenhuma marca registrada</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-[var(--series-1)] underline">{p.brands.length} marca{p.brands.length > 1 ? "s" : ""}</summary>
                        <ul className="mt-2 max-w-64 space-y-2">
                          {p.brands.map((brand) => (
                            <li key={brand.id} className="rounded border border-[var(--border)] p-2 text-[10px]">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-[var(--text-primary)]">{brand.marca}</span>
                                <span className={`rounded border px-1 py-0.5 ${CONFIANCA_BADGE_CLASS[brand.confianca] ?? ""}`}>{CONFIANCA_LABEL[brand.confianca] ?? brand.confianca}</span>
                              </div>
                              <div className="mt-1 text-[var(--text-muted)]">{TIPO_EVIDENCIA_MARCA_LABEL[brand.tipoEvidencia] ?? brand.tipoEvidencia}</div>
                              <div className="mt-1 text-[var(--text-secondary)]">{brand.evidencia}</div>
                              <a href={brand.fonteUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block underline text-[var(--series-1)]">Ver fonte ↗</a>
                              <div className="mt-1 text-[var(--text-muted)]">Verificado em {brand.dataVerificacao.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {!evidencias ? (
                      <span className="text-[var(--text-muted)]">Sem detalhamento disponível</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-[var(--text-secondary)] underline">Ver critérios avaliados</summary>
                        <ul className="mt-2 max-w-64 space-y-1 text-[10px] text-[var(--text-muted)]">
                          {evidencias.criterios.map((c) => (
                            <li key={c.id}>
                              <span className="font-medium text-[var(--text-secondary)]">{CRITERIO_GATE_LABEL[c.id] ?? c.id}:</span>{" "}
                              <span className={c.resultado === "NAO_ATENDE" ? "font-semibold text-red-600" : ""}>{RESULTADO_CRITERIO_LABEL[c.resultado] ?? c.resultado}</span>
                              {c.motivo && <div>{c.motivo}</div>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                    <details>
                      <summary className="cursor-pointer underline">Ver cadastro</summary>
                      <div className="mt-1 max-w-56 space-y-0.5 text-[10px] text-[var(--text-muted)]">
                        <div>CNPJ: {p.cnpj ?? "Não informado"}</div>
                        {p.cnpjRaiz && <div>Grupo (CNPJ raiz): {p.cnpjRaiz}</div>}
                        <div>Endereço: {[p.enderecoOficial, p.cidade, p.estado, p.cepOficial].filter(Boolean).join(" · ") || "Não informado"}</div>
                        <div>Situação cadastral: {p.situacaoCadastral ?? "Não informada"}</div>
                        <div>Porte: {p.porteEmpresa ?? "Não informado"}</div>
                        <div>Abertura: {p.dataAbertura?.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) ?? "Não informada"}</div>
                      </div>
                    </details>
                  </td>
                  <td className="px-4 py-3">
                    <form action={atualizarStatusProspectAction} className="flex min-w-44 items-center gap-1">
                      <input type="hidden" name="prospectId" value={p.id} />
                      <select name="status" defaultValue={p.status} aria-label="Estágio comercial" className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs">
                        {Object.entries(ESTAGIO_COMERCIAL_LABEL).filter(([key]) => key !== "CONVERTIDO").map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select>
                      <button type="submit" className="rounded-md border border-[var(--border)] px-2 py-1 text-xs">Salvar</button>
                    </form>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-[var(--text-secondary)] underline">Histórico ({p.activities.length})</summary>
                      <div className="mt-2 space-y-2">
                        {p.activities.map((activity) => (
                          <div key={activity.id} className="rounded border border-[var(--border)] p-2 text-[11px]">
                            <div className="font-medium">{activity.tipo.replaceAll("_", " ")}{activity.resultado ? ` · ${activity.resultado.replaceAll("_", " ")}` : ""}</div>
                            <div className="mt-0.5 text-[var(--text-secondary)]">{activity.descricao}</div>
                            <div className="mt-0.5 text-[var(--text-muted)]">{activity.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</div>
                          </div>
                        ))}
                      </div>
                      <form action={registrarInteracaoBruceAction} className="mt-2 min-w-48 space-y-2">
                        <input type="hidden" name="prospectId" value={p.id} />
                        <textarea name="descricao" required maxLength={1200} rows={2} placeholder="O que aconteceu na conversa?" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs" />
                        <button type="submit" className="w-full rounded-md border border-[var(--series-1)] px-2 py-1.5 text-xs font-medium">Registrar interação</button>
                      </form>
                    </details>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--text-muted)]">{p.updatedAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                </tr>
              );
            })}
            {prospects.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
                  Nenhum prospect aprovado ainda. O motor de qualificação acabou de entrar no ar — assim que alguém revisar e promover um PENDENTE_REVISAO_HUMANA, ele aparece aqui.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
