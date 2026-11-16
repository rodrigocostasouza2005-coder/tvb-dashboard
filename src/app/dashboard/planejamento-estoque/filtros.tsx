import { GetForm } from "../get-form";
import { FilterDropdown, CheckboxList } from "../filter-bar";

export type PlanejamentoFiltrosValue = {
  grupoIn: string[];
  tamanhoIn: string[];
  busca: string;
};

// Mesmo padrão de distribuicao-estoque/filtros.tsx — GetForm + FilterDropdown/CheckboxList
// reaproveitados, sem estado client. Coleção fica de fora aqui de propósito: o foco da Fase 1 é
// produto, não coleção (Drop entra via Módulo 6, Fase 5).
export function PlanejamentoFiltros({
  basePath,
  grupos,
  tamanhos,
  value,
}: {
  basePath: string;
  grupos: string[];
  tamanhos: string[];
  value: PlanejamentoFiltrosValue;
}) {
  const selectedGrupo = new Set(value.grupoIn);
  const selectedTamanho = new Set(value.tamanhoIn);

  return (
    <GetForm action={basePath} className="mb-4 flex flex-wrap items-center gap-2 text-xs">
      <FilterDropdown label="Grupo" count={selectedGrupo.size}>
        <CheckboxList name="grupo" options={grupos.map((g) => ({ value: g, label: g }))} selected={selectedGrupo} />
      </FilterDropdown>

      <FilterDropdown label="Tamanho" count={selectedTamanho.size}>
        <CheckboxList name="tamanho" options={tamanhos.map((t) => ({ value: t, label: t }))} selected={selectedTamanho} />
      </FilterDropdown>

      <input
        type="text"
        name="busca"
        placeholder="Buscar produto ou SKU..."
        defaultValue={value.busca}
        className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
      />

      <button
        type="submit"
        className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
      >
        Aplicar
      </button>
    </GetForm>
  );
}
