import { GetForm } from "../../get-form";
import { FilterDropdown, CheckboxList } from "../../filter-bar";
import { STATUS_COMERCIAL_LABEL } from "./format";

const HORIZONTE_OPCOES = [15, 30, 60, 90];

export type InteligenciaFiltrosValue = {
  grupoIn: string[];
  colecaoIn: string[];
  statusComercialIn: string[];
  horizonteDias: number;
  busca: string;
};

// Filtros da matriz unificada Best Seller/Drop (grupo, coleção, status comercial, horizonte de
// planejamento, busca por produto/SKU — pedido do Rodrigo em 2026-10-30) — reaproveita os mesmos
// componentes de src/app/dashboard/filter-bar.tsx (FilterDropdown/CheckboxList) e o GetForm
// (navegação sem recarregar a página inteira), só que com um conjunto de campos próprio: esses
// filtros são sobre CLASSIFICAÇÃO de produto, não sobre loja/marca/tabela de preço como o
// FilterBar original.
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

      <input
        type="text"
        name="busca"
        placeholder="Buscar produto ou SKU..."
        defaultValue={value.busca}
        className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
      />

      <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
        Horizonte de planejamento
        <select
          name="horizonte"
          defaultValue={String(value.horizonteDias)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
        >
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
