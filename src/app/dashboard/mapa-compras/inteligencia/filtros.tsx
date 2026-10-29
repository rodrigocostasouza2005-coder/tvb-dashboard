import { GetForm } from "../../get-form";
import { FilterDropdown, CheckboxList } from "../../filter-bar";
import { STATUS_COMERCIAL_LABEL } from "./format";

const HORIZONTE_OPCOES = [15, 30, 60, 90];

export type InteligenciaFiltrosValue = {
  modo: string;
  grupoIn: string[];
  colecaoIn: string[];
  statusComercialIn: string[];
  // null = sem simulação: cada grupo usa a própria meta de cobertura.
  horizonteDias: number | null;
};

// Filtros da seção "Inteligência de Compras" (seção 8 do pedido: grupo, coleção, status
// comercial, horizonte de planejamento) — reaproveita os mesmos componentes de
// src/app/dashboard/filter-bar.tsx (FilterDropdown/CheckboxList) e o GetForm (navegação sem
// recarregar a página inteira), só que com um conjunto de campos próprio: esses filtros são
// sobre CLASSIFICAÇÃO de produto, não sobre loja/marca/tabela de preço como o FilterBar original.
export function InteligenciaFiltros({
  basePath,
  grupos,
  colecoes,
  statusComercialDisponiveis,
  value,
}: {
  basePath: string;
  grupos: string[];
  colecoes: string[];
  statusComercialDisponiveis: string[];
  value: InteligenciaFiltrosValue;
}) {
  const selectedGrupo = new Set(value.grupoIn);
  const selectedColecao = new Set(value.colecaoIn);
  const selectedStatus = new Set(value.statusComercialIn);

  return (
    <GetForm action={basePath} className="mb-4 flex flex-wrap items-center gap-2">
      <input type="hidden" name="modo" value={value.modo} />

      <FilterDropdown label="Grupo" count={selectedGrupo.size}>
        <CheckboxList name="grupo" options={grupos.map((g) => ({ value: g, label: g }))} selected={selectedGrupo} />
      </FilterDropdown>

      <FilterDropdown label="Coleção" count={selectedColecao.size}>
        <CheckboxList name="colecao" options={colecoes.map((c) => ({ value: c, label: c }))} selected={selectedColecao} />
      </FilterDropdown>

      <FilterDropdown label="Status comercial" count={selectedStatus.size}>
        <CheckboxList
          name="status"
          options={statusComercialDisponiveis.map((s) => ({ value: s, label: STATUS_COMERCIAL_LABEL[s] ?? s }))}
          selected={selectedStatus}
        />
      </FilterDropdown>

      <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
        Horizonte de planejamento
        <select
          name="horizonte"
          defaultValue={value.horizonteDias == null ? "" : String(value.horizonteDias)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
        >
          <option value="">Meta de cobertura do grupo</option>
          {HORIZONTE_OPCOES.map((h) => (
            <option key={h} value={h}>
              {h} dias
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
      >
        Aplicar
      </button>
    </GetForm>
  );
}
