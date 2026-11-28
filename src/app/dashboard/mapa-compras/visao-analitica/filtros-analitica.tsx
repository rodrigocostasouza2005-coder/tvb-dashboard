import { GetForm } from "../../get-form";
import type { PosicaoEstoque } from "@/lib/metrics";

const PERIODO_OPCOES = [30, 60, 90, 180];

export type FiltrosAnaliticaValue = {
  grupo: string; // "" = todos
  bestSeller: "todos" | "bs" | "nbs";
  posicaoId: string; // "" = consolidado
  tamanho: string; // "" = todos
  periodoDias: number;
};

// Filtros da Visão Analítica (seção 4/5.1 do briefing) — grupo usa a MESMA chave de query string
// (`grupo`) que InteligenciaFiltros (Planejamento Mensal), então trocar de aba preserva o grupo
// selecionado (seção 19: filtros compartilhados). Os demais (classificação/loja/tamanho/período)
// são específicos desta aba — não têm equivalente conceitual na matriz mensal.
export function FiltrosAnalitica({
  basePath,
  abaAtiva,
  grupos,
  posicoes,
  tamanhos,
  value,
}: {
  basePath: string;
  abaAtiva: string;
  grupos: string[];
  posicoes: PosicaoEstoque[];
  tamanhos: string[];
  value: FiltrosAnaliticaValue;
}) {
  return (
    <GetForm action={basePath} className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
      <input type="hidden" name="aba" value={abaAtiva} />
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-[var(--text-muted)]">Grupo</span>
        <select name="grupo" defaultValue={value.grupo} className="rounded-md border border-[var(--border)] bg-[var(--page-plane)] px-2 py-1.5 text-xs text-[var(--text-primary)]">
          <option value="">Todos os grupos</option>
          {grupos.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-[var(--text-muted)]">Classificação</span>
        <select name="bestSeller" defaultValue={value.bestSeller} className="rounded-md border border-[var(--border)] bg-[var(--page-plane)] px-2 py-1.5 text-xs text-[var(--text-primary)]">
          <option value="todos">Todos</option>
          <option value="bs">Best Seller</option>
          <option value="nbs">Não Best Seller</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-[var(--text-muted)]">Loja</span>
        <select name="posicao" defaultValue={value.posicaoId} className="rounded-md border border-[var(--border)] bg-[var(--page-plane)] px-2 py-1.5 text-xs text-[var(--text-primary)]">
          <option value="">Consolidado</option>
          {posicoes.map((p) => (
            <option key={p.posicaoId} value={p.posicaoId}>
              {p.nome}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-[var(--text-muted)]">Tamanho</span>
        <select name="tamanho" defaultValue={value.tamanho} className="rounded-md border border-[var(--border)] bg-[var(--page-plane)] px-2 py-1.5 text-xs text-[var(--text-primary)]">
          <option value="">Todos</option>
          {tamanhos.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-[var(--text-muted)]">Período</span>
        <select name="periodo" defaultValue={String(value.periodoDias)} className="rounded-md border border-[var(--border)] bg-[var(--page-plane)] px-2 py-1.5 text-xs text-[var(--text-primary)]">
          {PERIODO_OPCOES.map((p) => (
            <option key={p} value={p}>
              Últimos {p} dias
            </option>
          ))}
        </select>
      </label>

      <button type="submit" className="rounded-md border border-[var(--border)] bg-[var(--page-plane)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-1)]">
        Aplicar
      </button>
    </GetForm>
  );
}
