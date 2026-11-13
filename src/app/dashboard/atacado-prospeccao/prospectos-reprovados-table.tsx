import type { ProspectoReprovado } from "@/lib/metrics/prospeccao-qualificacao";
import { RESULTADO_ELIMINACAO_LABEL } from "./qualificacao-labels";
import { prepararExclusaoProspectosAction } from "./actions";
import { SelectAllCheckbox } from "./select-all-checkbox";

const FORM_ID = "bulk-reprovados-form";

// Só pra auditoria ("alguém quer checar por que uma reprovação aconteceu") — nunca é uma fila de
// trabalho. Fica dentro de um <details> fechado por padrão na página (ver page.tsx), não solta
// na tela por cima dos aprovados/pendentes que são o que importa no dia a dia.
//
// Exclusão definitiva (2026-11-13): reprovados pelo motor são o candidato mais seguro e mais
// justificado pra limpeza da base (gate já rodou, já reprovou, com motivo registrado) — por isso
// esta é a ÚNICA tabela de qualificação com exclusão em massa própria, sem precisar passar pela
// Carteira (que, de propósito, oculta reprovados por padrão — ver page.tsx).
export function ProspectosReprovadosTable({ prospects, podeExcluir }: { prospects: ProspectoReprovado[]; podeExcluir: boolean }) {
  return (
    <div className="overflow-x-auto">
      {podeExcluir && prospects.length > 0 && (
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--page-plane)] px-4 py-2">
          <p className="text-xs text-[var(--text-muted)]">Reprovados pelo motor são o candidato mais seguro pra exclusão definitiva.</p>
          <button type="submit" form={FORM_ID} className="rounded-md border border-red-500/50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10">Excluir selecionados</button>
        </div>
      )}
      <form id={FORM_ID} action={prepararExclusaoProspectosAction} />
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-[var(--text-muted)]">
          <tr>
            {podeExcluir && <th className="px-4 py-3 font-medium"><SelectAllCheckbox formId={FORM_ID} name="ids" /></th>}
            <th className="px-4 py-3 font-medium">Loja</th>
            <th className="px-4 py-3 font-medium">Localização</th>
            <th className="px-4 py-3 font-medium">Motivos da reprovação</th>
            <th className="px-4 py-3 font-medium">Atualizado</th>
          </tr>
        </thead>
        <tbody>
          {prospects.map((p) => (
            <tr key={p.id} className="border-t border-[var(--border)] align-top">
              {podeExcluir && (
                <td className="px-4 py-3">
                  <input type="checkbox" name="ids" value={p.id} form={FORM_ID} aria-label={`Selecionar ${p.nomeFantasia}`} className="h-3.5 w-3.5" />
                </td>
              )}
              <td className="px-4 py-3">
                <div className="font-medium">{p.nomeFantasia}</div>
                {p.cnpj && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{p.cnpj}</div>}
                {p.resultadoEliminacao && <div className="mt-1 text-[10px] text-[var(--text-muted)]">{RESULTADO_ELIMINACAO_LABEL[p.resultadoEliminacao] ?? p.resultadoEliminacao}</div>}
              </td>
              <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">{[p.cidade, p.estado].filter(Boolean).join(" / ") || "Não identificado"}</td>
              <td className="px-4 py-3">
                {p.motivosEliminacao.length === 0 ? (
                  <span className="text-xs text-[var(--text-muted)]">Nenhum motivo registrado</span>
                ) : (
                  <ul className="flex max-w-80 flex-wrap gap-1">
                    {p.motivosEliminacao.map((motivo, index) => (
                      <li key={index} className="rounded border border-red-500/30 bg-red-500/5 px-1.5 py-0.5 text-[10px] text-red-700">{motivo}</li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--text-muted)]">{p.updatedAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
            </tr>
          ))}
          {prospects.length === 0 && (
            <tr>
              <td colSpan={podeExcluir ? 5 : 4} className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">Nenhuma reprovação registrada.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
