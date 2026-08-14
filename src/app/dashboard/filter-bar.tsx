import type { DashboardFilters } from "@/lib/metrics";
import { toDateInputValue } from "@/lib/filters";

type Store = { id: string; name: string };

function CheckboxGroup({
  label,
  name,
  options,
  selected,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <label key={opt.value} className="flex items-center gap-1.5 text-[var(--text-secondary)]">
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
      className="mb-6 flex flex-wrap items-end gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3 text-sm"
    >
      <CheckboxGroup
        label="Loja"
        name="store"
        options={stores.map((s) => ({ value: s.id, label: s.name }))}
        selected={selectedStores}
      />

      {showMarca && (
        <CheckboxGroup
          label="Marca"
          name="marca"
          options={marcas.map((m) => ({ value: m, label: m }))}
          selected={selectedMarcas}
        />
      )}

      {showTabelaPreco && (
        <CheckboxGroup
          label="Tabela de preço"
          name="tabelaPreco"
          options={(tabelasPreco ?? []).map((t) => ({ value: t, label: t }))}
          selected={selectedTabelas}
        />
      )}

      {/* Os dois campos de data ficam juntos num bloco só — soltos direto no flex-wrap do
          formulário, eles podiam parar em linhas diferentes (um de cada lado) dependendo da
          largura disponível. */}
      {showDate && <div className="flex items-end gap-3">
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
      </div>}

      <button
        type="submit"
        className="rounded-md bg-[var(--series-1)] px-3 py-1.5 text-sm font-medium text-white"
      >
        Aplicar
      </button>
    </form>
  );
}
