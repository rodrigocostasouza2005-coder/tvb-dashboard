import { toDateInputValue } from "@/lib/filters";
import type { PerformanceFilters } from "@/lib/performance";
import { FilterDropdown, CheckboxList } from "../filter-bar";

// Mesmo padrão visual do FilterBar (loja/marca/data), reaproveitando os mesmos componentes de
// dropdown — domínio diferente (perfil/tipo/classificação em vez de loja/marca), por isso um
// filtro próprio em vez de encaixar à força no FilterBar existente.
export function PerformanceFilterBar({
  action,
  perfis,
  filters,
  showTipoClassificacao = false,
  extraHidden,
}: {
  action: string;
  perfis: string[];
  filters: PerformanceFilters;
  showTipoClassificacao?: boolean;
  extraHidden?: Record<string, string>;
}) {
  const selectedPerfis = new Set(filters.perfilIn ?? []);
  const selectedTipos = new Set(filters.tipoIn ?? []);
  const selectedClassificacoes = new Set(filters.classificacaoIn ?? []);

  return (
    <form action={action} method="GET" className="mb-6 flex flex-wrap items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3 text-sm">
      <input type="hidden" name="filtros" value="1" />
      {extraHidden &&
        Object.entries(extraHidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}

      <FilterDropdown label="Perfil" count={selectedPerfis.size}>
        <CheckboxList name="perfil" options={perfis.map((p) => ({ value: p, label: p }))} selected={selectedPerfis} />
      </FilterDropdown>

      {showTipoClassificacao && (
        <>
          <FilterDropdown label="Tipo" count={selectedTipos.size}>
            <CheckboxList
              name="tipo"
              options={[{ value: "STORY", label: "Story" }, { value: "POST", label: "Post" }]}
              selected={selectedTipos}
            />
          </FilterDropdown>

          <FilterDropdown label="Classificação" count={selectedClassificacoes.size}>
            <CheckboxList
              name="classificacao"
              options={[{ value: "QUALIFICADO", label: "Qualificado" }, { value: "BASICO", label: "Básico" }]}
              selected={selectedClassificacoes}
            />
          </FilterDropdown>
        </>
      )}

      <FilterDropdown label="Período" count={0}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="from">De</label>
            <input
              id="from"
              type="date"
              name="from"
              defaultValue={toDateInputValue(filters.from)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-primary)]"
              style={{ colorScheme: "light dark" }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="to">Até</label>
            <input
              id="to"
              type="date"
              name="to"
              defaultValue={toDateInputValue(filters.to)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-primary)]"
              style={{ colorScheme: "light dark" }}
            />
          </div>
        </div>
      </FilterDropdown>

      <button type="submit" className="rounded-md bg-[var(--series-1)] px-3 py-1.5 text-sm font-medium text-white">
        Aplicar
      </button>
    </form>
  );
}
