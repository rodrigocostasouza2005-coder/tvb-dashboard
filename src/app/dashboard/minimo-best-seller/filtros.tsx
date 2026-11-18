import { GetForm } from "../get-form";
import { FilterDropdown, CheckboxList } from "../filter-bar";

export type MinimoBestSellerFiltrosValue = {
  tamanhoIn: string[];
  busca: string;
};

// Mesmo padrão de planejamento-estoque/filtros.tsx (GetForm + FilterDropdown/CheckboxList, sem
// estado client). Loja de propósito NÃO entra aqui — o mínimo empresarial nunca é avaliado por
// loja, só o consolidado (ver page.tsx); "onde está esse tamanho hoje" é só leitura dentro do
// detalhe do produto, reaproveitando porLoja que já vem no item.
export function MinimoBestSellerFiltros({
  basePath,
  tamanhos,
  value,
}: {
  basePath: string;
  tamanhos: string[];
  value: MinimoBestSellerFiltrosValue;
}) {
  const selectedTamanho = new Set(value.tamanhoIn);

  return (
    <GetForm action={basePath} className="mb-4 flex flex-wrap items-center gap-2 text-xs">
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
