import type { ReactNode } from "react";
import type { DashboardFilters } from "@/lib/metrics";
import { toDateInputValue } from "@/lib/filters";

type Store = { id: string; name: string };

// Cada filtro (Loja/Marca/Tabela de preço/Data) fica no seu próprio dropdown, em vez de um
// bloco só com tudo junto — pedido do Rodrigo em 2026-08-24 pra deixar mais organizado.
// <details>/<summary> nativo: abre/fecha sem precisar de client component nem JS.
function FilterDropdown({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--page-plane)] [&::-webkit-details-marker]:hidden">
        {label}
        {count > 0 && (
          <span className="rounded-full bg-[var(--series-1)] px-1.5 text-xs font-medium text-white">{count}</span>
        )}
        <span aria-hidden className="text-[10px] text-[var(--text-muted)] transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="absolute left-0 z-10 mt-2 min-w-[220px] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 shadow-lg">
        {children}
      </div>
    </details>
  );
}

function CheckboxList({
  name,
  options,
  selected,
}: {
  name: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
}) {
  return (
    <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
      {options.map((opt) => (
        <label key={opt.value} className="flex items-center gap-1.5 whitespace-nowrap text-[var(--text-secondary)]">
          <input
            type="checkbox"
            name={name}
            value={opt.value}
            defaultChecked={opt.value.split("|").some((v) => selected.has(v))}
            className="accent-[var(--series-1)]"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

export function FilterBar({
  action,
  stores,
  marcas,
  tabelasPreco,
  filters,
  showMarca = true,
  showTabelaPreco = false,
  showDate = true,
}: {
  action: string;
  stores: Store[];
  marcas: string[];
  tabelasPreco?: string[];
  filters: DashboardFilters;
  showMarca?: boolean;
  showTabelaPreco?: boolean;
  showDate?: boolean;
}) {
  const selectedStores = new Set(filters.storeIds ?? []);
  const selectedMarcas = new Set(filters.marcas ?? []);
  const selectedTabelas = new Set(filters.tabelasPreco ?? []);

  return (
    <form
      action={action}
      method="GET"
      className="mb-6 flex flex-wrap items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3 text-sm"
    >
      {/* Se o Aplicar veio daqui, o painel de filtros estava aberto — mantém aberto na
          próxima página em vez de fechar (CollapsibleFilters lê isso via searchParams). */}
      <input type="hidden" name="filtros" value="1" />

      <FilterDropdown label="Loja" count={selectedStores.size}>
        <CheckboxList name="store" options={stores.map((s) => ({ value: s.id, label: s.name }))} selected={selectedStores} />
      </FilterDropdown>

      {showMarca && (
        <FilterDropdown label="Marca" count={selectedMarcas.size}>
          <CheckboxList name="marca" options={marcas.map((m) => ({ value: m, label: m }))} selected={selectedMarcas} />
        </FilterDropdown>
      )}

      {showTabelaPreco && (
        <FilterDropdown label="Tabela de preço" count={selectedTabelas.size}>
          <CheckboxList
            name="tabelaPreco"
            options={(tabelasPreco ?? []).map((t) => ({ value: t, label: t }))}
            selected={selectedTabelas}
          />
        </FilterDropdown>
      )}

      {showDate && (
        <FilterDropdown label="Data" count={0}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="from">
                De
              </label>
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
              <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="to">
                Até
              </label>
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
      )}

      <button
        type="submit"
        className="rounded-md bg-[var(--series-1)] px-3 py-1.5 text-sm font-medium text-white"
      >
        Aplicar
      </button>
    </form>
  );
}
