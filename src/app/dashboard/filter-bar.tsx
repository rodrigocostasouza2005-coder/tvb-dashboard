import type { DashboardFilters } from "@/lib/metrics";
import { toDateInputValue } from "@/lib/filters";

type Store = { id: string; name: string };

export function FilterBar({
  action,
  stores,
  marcas,
  tabelasPreco,
  filters,
  showMarca = true,
  showTabelaPreco = false,
}: {
  action: string;
  stores: Store[];
  marcas: string[];
  tabelasPreco?: string[];
  filters: DashboardFilters;
  showMarca?: boolean;
  showTabelaPreco?: boolean;
}) {
  const selectedStores = new Set(filters.storeIds ?? []);

  return (
    <form
      action={action}
      method="GET"
      className="mb-6 flex flex-wrap items-end gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 text-sm"
    >
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--text-muted)]">Loja</span>
        <div className="flex flex-wrap gap-2">
          {stores.map((s) => (
            <label key={s.id} className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <input
                type="checkbox"
                name="store"
                value={s.id}
                defaultChecked={selectedStores.has(s.id)}
                className="accent-[var(--series-1)]"
              />
              {s.name}
            </label>
          ))}
        </div>
      </div>

      {showMarca && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="marca">
            Marca
          </label>
          <select
            id="marca"
            name="marca"
            defaultValue={filters.marca ?? ""}
            className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-primary)]"
            style={{ colorScheme: "light dark" }}
          >
            <option value="">Todas</option>
            {marcas.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}

      {showTabelaPreco && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="tabelaPreco">
            Tabela de preço
          </label>
          <select
            id="tabelaPreco"
            name="tabelaPreco"
            defaultValue={filters.tabelaPreco ?? ""}
            className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-primary)]"
            style={{ colorScheme: "light dark" }}
          >
            <option value="">Todas</option>
            {(tabelasPreco ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      )}

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

      <button
        type="submit"
        className="rounded-md bg-[var(--series-1)] px-3 py-1.5 text-sm font-medium text-white"
      >
        Aplicar
      </button>
    </form>
  );
}
