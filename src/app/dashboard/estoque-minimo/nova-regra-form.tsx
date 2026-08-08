import { createMinimumRuleAction } from "./actions";

type StoreOption = { id: string; name: string };

const selectClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]";

// Todos os selects mostram a lista completa desde o início, nenhum depende do outro nem fica
// desabilitado — Rodrigo preenche rápido via Tab, tipo planilha, sem esperar cascata.
export function NovaRegraForm({
  stores,
  colecoes,
  grupos,
  tamanhos,
}: {
  stores: StoreOption[];
  colecoes: string[];
  grupos: string[];
  tamanhos: string[];
}) {
  return (
    <form action={createMinimumRuleAction} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-[var(--text-muted)]" htmlFor="storeId">
          Loja
        </label>
        <select id="storeId" name="storeId" required className={selectClass} style={{ colorScheme: "light dark" }}>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[var(--text-muted)]" htmlFor="colecao">
          Coleção
        </label>
        <select id="colecao" name="colecao" defaultValue="" className={selectClass} style={{ colorScheme: "light dark" }}>
          <option value="">Todas</option>
          {colecoes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[var(--text-muted)]" htmlFor="grupo">
          Grupo
        </label>
        <select id="grupo" name="grupo" required className={selectClass} style={{ colorScheme: "light dark" }}>
          {grupos.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[var(--text-muted)]" htmlFor="tamanho">
          Tamanho
        </label>
        <select id="tamanho" name="tamanho" required className={selectClass} style={{ colorScheme: "light dark" }}>
          {tamanhos.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-[var(--text-muted)]" htmlFor="valorMinimo">
          Estoque mínimo
        </label>
        <input
          id="valorMinimo"
          name="valorMinimo"
          type="number"
          min={0}
          required
          className="w-28 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]"
          style={{ colorScheme: "light dark" }}
        />
      </div>

      <button type="submit" className="rounded-md bg-[var(--series-1)] px-3 py-1.5 text-sm font-medium text-white">
        Salvar
      </button>
    </form>
  );
}
