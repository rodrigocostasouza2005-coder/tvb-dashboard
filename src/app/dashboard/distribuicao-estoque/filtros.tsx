import { GetForm } from "../get-form";
import { FilterDropdown, CheckboxList } from "../filter-bar";
import { TIPOS_MOVIMENTACAO } from "./format";
import type { AbaDistribuicao } from "./aba-nav";
import type { Prioridade, TipoMovimentacao } from "@/lib/metrics";

// "desequilibrio" (default, pedido do Rodrigo em 2026-11-10: "está muito difícil de ver") —
// antes o default era "todos" (literalmente sem filtro nenhum), e numa base de catálogo grande
// isso virava uma parede de ~700 variantes × 3 lojas, a maioria "Sem dado suficiente" (achado real
// na própria sessão: ~10 mil células nesse estado, dominando qualquer coisa que importasse de
// verdade). "tudo" preserva o comportamento antigo como opção explícita pra quem quiser auditar.
export type NivelDesequilibrio = "desequilibrio" | "critico" | "excesso" | "tudo";

export const PRIORIDADES: { value: Prioridade; label: string }[] = [
  { value: "alta", label: "Alta" },
  { value: "media", label: "Média" },
  { value: "baixa", label: "Baixa" },
];

export type DistribuicaoFiltrosValue = {
  grupoIn: string[];
  colecaoIn: string[];
  tamanhoIn: string[];
  busca: string;
  nivel: NivelDesequilibrio;
  origemIn: string[];
  destinoIn: string[];
  tipoIn: TipoMovimentacao[];
  prioridadeIn: Prioridade[];
};

// CheckboxList marca a opção com `opt.value.split("|").some(v => selected.has(v))` — o id de
// posição do CD/Site é "idCD|idATACADO", então o Set precisa conter TAMBÉM as partes, senão a
// opção do CD/Site nunca aparece marcada depois de aplicada. Resolvido aqui, numa função só, em
// vez de mudar o componente compartilhado.
function setComPartes(valores: string[]): Set<string> {
  const s = new Set<string>();
  for (const v of valores) {
    s.add(v);
    for (const parte of v.split("|")) s.add(parte);
  }
  return s;
}

// Mesmo padrão de inteligencia/filtros.tsx (Mapa de Compras): GetForm + FilterDropdown/
// CheckboxList reaproveitados. Os filtros de origem/destino/tipo/prioridade só aparecem na aba
// Movimentações — nas outras não existe "movimentação" pra filtrar, e dropdown inerte é pior que
// dropdown ausente.
export function DistribuicaoFiltros({
  basePath,
  aba,
  grupos,
  colecoes,
  tamanhos,
  unidades,
  value,
}: {
  basePath: string;
  aba: AbaDistribuicao;
  grupos: string[];
  colecoes: string[];
  tamanhos: string[];
  unidades: { posicaoId: string; posicaoNome: string }[];
  value: DistribuicaoFiltrosValue;
}) {
  const selectedGrupo = new Set(value.grupoIn);
  const selectedColecao = new Set(value.colecaoIn);
  const selectedTamanho = new Set(value.tamanhoIn);
  const selectedOrigem = setComPartes(value.origemIn);
  const selectedDestino = setComPartes(value.destinoIn);
  const selectedTipo = new Set<string>(value.tipoIn);
  const selectedPrioridade = new Set<string>(value.prioridadeIn);
  const unidadeOptions = unidades.map((u) => ({ value: u.posicaoId, label: u.posicaoNome }));
  const mostraFiltrosDeMovimentacao = aba === "movimentacoes";

  return (
    <GetForm action={basePath} className="mb-4 flex flex-wrap items-center gap-2 text-xs">
      <input type="hidden" name="aba" value={aba} />

      <FilterDropdown label="Grupo" count={selectedGrupo.size}>
        <CheckboxList name="grupo" options={grupos.map((g) => ({ value: g, label: g }))} selected={selectedGrupo} />
      </FilterDropdown>

      <FilterDropdown label="Coleção" count={selectedColecao.size}>
        <CheckboxList name="colecao" options={colecoes.map((c) => ({ value: c, label: c }))} selected={selectedColecao} />
      </FilterDropdown>

      <FilterDropdown label="Tamanho" count={selectedTamanho.size}>
        <CheckboxList name="tamanho" options={tamanhos.map((t) => ({ value: t, label: t }))} selected={selectedTamanho} />
      </FilterDropdown>

      {mostraFiltrosDeMovimentacao && (
        <>
          <FilterDropdown label="Origem" count={value.origemIn.length}>
            <CheckboxList name="origem" options={unidadeOptions} selected={selectedOrigem} />
          </FilterDropdown>

          <FilterDropdown label="Destino" count={value.destinoIn.length}>
            <CheckboxList name="destino" options={unidadeOptions} selected={selectedDestino} />
          </FilterDropdown>

          <FilterDropdown label="Tipo de movimentação" count={selectedTipo.size}>
            <CheckboxList name="tipo" options={TIPOS_MOVIMENTACAO} selected={selectedTipo} />
          </FilterDropdown>

          <FilterDropdown label="Prioridade" count={selectedPrioridade.size}>
            <CheckboxList name="prioridade" options={PRIORIDADES} selected={selectedPrioridade} />
          </FilterDropdown>
        </>
      )}

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
