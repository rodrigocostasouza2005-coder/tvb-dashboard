import { createContentAction, updateContentAction } from "./actions";
import { toDateInputValue } from "@/lib/filters";
import type { ContentPerformance } from "@prisma/client";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm text-[var(--text-primary)]";

export function ContentForm({ perfis, editing }: { perfis: string[]; editing: ContentPerformance | null }) {
  const action = editing ? updateContentAction : createContentAction;

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      {editing && <input type="hidden" name="id" value={editing.id} />}

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="perfil">Perfil</label>
        <input
          id="perfil"
          name="perfil"
          list="perfis-datalist"
          defaultValue={editing?.perfil ?? ""}
          placeholder="Nome do influenciador/perfil"
          required
          autoComplete="off"
          className={`${inputClass} w-48`}
          style={{ colorScheme: "light dark" }}
        />
        <datalist id="perfis-datalist">
          {perfis.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="tipo">Tipo</label>
        <select id="tipo" name="tipo" defaultValue={editing?.tipo ?? "STORY"} required className={inputClass} style={{ colorScheme: "light dark" }}>
          <option value="STORY">Story</option>
          <option value="POST">Post</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="classificacao">Classificação</label>
        <select
          id="classificacao"
          name="classificacao"
          defaultValue={editing?.classificacao ?? "BASICO"}
          required
          className={inputClass}
          style={{ colorScheme: "light dark" }}
        >
          <option value="QUALIFICADO">Qualificado</option>
          <option value="BASICO">Básico</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="data">Data</label>
        <input
          id="data"
          name="data"
          type="date"
          defaultValue={editing ? toDateInputValue(editing.data) : toDateInputValue(new Date())}
          required
          className={inputClass}
          style={{ colorScheme: "light dark" }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="engajamento">Engajamento</label>
        <input
          id="engajamento"
          name="engajamento"
          type="number"
          min={0}
          defaultValue={editing?.engajamento ?? ""}
          placeholder="opcional"
          className={`${inputClass} w-28`}
          style={{ colorScheme: "light dark" }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="observacoes">Observações</label>
        <input
          id="observacoes"
          name="observacoes"
          defaultValue={editing?.observacoes ?? ""}
          placeholder="opcional"
          className={`${inputClass} w-64`}
          style={{ colorScheme: "light dark" }}
        />
      </div>

      <div className="flex gap-2">
        <button type="submit" className="rounded-md bg-[var(--series-1)] px-4 py-1.5 text-sm font-medium text-white">
          {editing ? "Salvar alterações" : "Adicionar"}
        </button>
        {editing && (
          <a
            href="/dashboard/performance"
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
          >
            Cancelar
          </a>
        )}
      </div>
    </form>
  );
}
