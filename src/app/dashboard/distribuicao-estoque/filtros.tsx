import { GetForm } from "../get-form";
import { FilterDropdown, CheckboxList } from "../filter-bar";

// "desequilibrio" (default, pedido do Rodrigo em 2026-11-10: "está muito difícil de ver") —
// antes o default era "todos" (literalmente sem filtro nenhum), e numa base de catálogo grande
// isso virava uma parede de ~700 variantes × 3 lojas, a maioria "Sem dado suficiente" (achado real
// na própria sessão: ~10 mil células nesse estado, dominando qualquer coisa que importasse de
// verdade). "tudo" preserva o comportamento antigo como opção explícita pra quem quiser auditar.
export type NivelDesequilibrio = "desequilibrio" | "critico" | "excesso" | "tudo";

export type DistribuicaoFiltrosValue = {
  grupoIn: string[];
  colecaoIn: string[];
  busca: string;
  nivel: NivelDesequilibrio;
};

// Mesmo padrão de inteligencia/filtros.tsx (Mapa de Compras): GetForm + FilterDropdown/
// CheckboxList reaproveitados, campos próprios (aqui não existe conceito de Loja — a tela SEMPRE
// compara as lojas físicas entre si, loja não é algo que se "filtra fora").
export function DistribuicaoFiltros({
  basePath,
  grupos,
  colecoes,
  value,
}: {
  basePath: string;
  grupos: string[];
  colecoes: string[];
  value: DistribuicaoFiltrosValue;
}) {
  const selectedGrupo = new Set(value.grupoIn);
  const selectedColecao = new Set(value.colecaoIn);

  return (
    <GetForm action={basePath} className="mb-4 flex flex-wrap items-center gap-2">
      <FilterDropdown label="Grupo" count={selectedGrupo.size}>
        <CheckboxList name="grupo" options={grupos.map((g) => ({ value: g, label: g }))} selected={selectedGrupo} />
      </FilterDropdown>

      <FilterDropdown label="Coleção" count={selectedColecao.size}>
        <CheckboxList name="colecao" options={colecoes.map((c) => ({ value: c, label: c }))} selected={selectedColecao} />
      </FilterDropdown>

      <input
        type="text"
        name="busca"
        placeholder="Buscar produto ou SKU..."
        defaultValue={value.busca}
        className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
      />

      <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
        Nível de desequilíbrio
        <select
          name="nivel"
          defaultValue={value.nivel}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
        >
          <option value="desequilibrio">Só com desequilíbrio (padrão)</option>
          <option value="critico">Só ruptura/cobertura crítica</option>
          <option value="excesso">Só excesso/estoque parado</option>
          <option value="tudo">Tudo (inclui equilibrado/sem dado)</option>
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
