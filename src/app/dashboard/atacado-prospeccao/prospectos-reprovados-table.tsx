import type { ProspectoReprovado } from "@/lib/metrics/prospeccao-qualificacao";
import { RESULTADO_ELIMINACAO_LABEL } from "./qualificacao-labels";

// Só pra auditoria ("alguém quer checar por que uma reprovação aconteceu") — nunca é uma fila de
// trabalho. Fica dentro de um <details> fechado por padrão na página (ver page.tsx), não solta
// na tela por cima dos aprovados/pendentes que são o que importa no dia a dia.
export function ProspectosReprovadosTable({ prospects }: { prospects: ProspectoReprovado[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-[var(--text-muted)]">
          <tr>
            <th className="px-4 py-3 font-medium">Loja</th>
            <th className="px-4 py-3 font-medium">Localização</th>
            <th className="px-4 py-3 font-medium">Motivos da reprovação</th>
            <th className="px-4 py-3 font-medium">Atualizado</th>
          </tr>
        </thead>
        <tbody>
          {prospects.map((p) => (
            <tr key={p.id} className="border-t border-[var(--border)] align-top">
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
              <td colSpan={4} className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">Nenhuma reprovação registrada.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
