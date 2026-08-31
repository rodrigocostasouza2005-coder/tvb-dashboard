"use client";

import { useMemo, useState } from "react";

type Row = { grupo: string; produto: string; tamanho: string; currentStock: number; unitsSold: number };
type Agg = { key: string; currentStock: number; unitsSold: number };

const COR_ESTOQUE = "#eb6834";
const COR_VENDIDO = "#2a78d6";

function aggregate(rows: Row[], pick: (r: Row) => string): Agg[] {
  const map = new Map<string, Agg>();
  for (const r of rows) {
    const key = pick(r);
    const cur = map.get(key) ?? { key, currentStock: 0, unitsSold: 0 };
    cur.currentStock += r.currentStock;
    cur.unitsSold += r.unitsSold;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.unitsSold - a.unitsSold);
}

function BarRow({ item, max, selected, onClick }: { item: Agg; max: number; selected: boolean; onClick: () => void }) {
  const pctEstoque = max > 0 ? Math.min(100, (Math.max(0, item.currentStock) / max) * 100) : 0;
  const pctVendido = max > 0 ? Math.min(100, (Math.max(0, item.unitsSold) / max) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-md px-2 py-1.5 text-left transition-colors ${
        selected ? "bg-[var(--page-plane)] ring-1 ring-[var(--series-1)]" : "hover:bg-[var(--page-plane)]"
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-medium text-[var(--text-primary)]">{item.key}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <div className="h-2 flex-1 rounded-full bg-[var(--gridline)]">
            <div className="h-2 rounded-full" style={{ width: `${pctEstoque}%`, backgroundColor: COR_ESTOQUE }} />
          </div>
          <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-[var(--text-muted)]">{item.currentStock.toLocaleString("pt-BR")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2 flex-1 rounded-full bg-[var(--gridline)]">
            <div className="h-2 rounded-full" style={{ width: `${pctVendido}%`, backgroundColor: COR_VENDIDO }} />
          </div>
          <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-[var(--text-muted)]">{item.unitsSold.toLocaleString("pt-BR")}</span>
        </div>
      </div>
    </button>
  );
}

function Panel({
  title,
  items,
  selected,
  onToggle,
  emptyMessage,
}: {
  title: string;
  items: Agg[];
  selected: string[];
  onToggle: (key: string) => void;
  emptyMessage: string;
}) {
  const max = Math.max(1, ...items.map((i) => Math.max(i.currentStock, i.unitsSold)));
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium text-[var(--text-secondary)]">{title}</h3>
        {selected.length > 0 && (
          <span className="text-[10px] text-[var(--text-muted)]">{selected.length} selecionado{selected.length > 1 ? "s" : ""}</span>
        )}
      </div>
      <div className="flex max-h-[520px] flex-col gap-0.5 overflow-y-auto">
        {items.map((item) => (
          <BarRow key={item.key} item={item} max={max} selected={selected.includes(item.key)} onClick={() => onToggle(item.key)} />
        ))}
        {items.length === 0 && <p className="px-2 py-4 text-center text-xs text-[var(--text-muted)]">{emptyMessage}</p>}
      </div>
    </div>
  );
}

export function EstoqueVendasDinamico({
  rows,
  giroPorGrupo,
}: {
  rows: Row[];
  giroPorGrupo: { key: string; sellThroughRate: number | null }[];
}) {
  const [selectedGrupos, setSelectedGrupos] = useState<string[]>([]);
  const [selectedProdutos, setSelectedProdutos] = useState<string[]>([]);

  const grupoAgg = useMemo(() => aggregate(rows, (r) => r.grupo), [rows]);

  const rowsPorGrupo = useMemo(
    () => (selectedGrupos.length > 0 ? rows.filter((r) => selectedGrupos.includes(r.grupo)) : rows),
    [rows, selectedGrupos]
  );
  const produtoAgg = useMemo(() => aggregate(rowsPorGrupo, (r) => r.produto), [rowsPorGrupo]);

  const rowsPorProduto = useMemo(
    () => (selectedProdutos.length > 0 ? rowsPorGrupo.filter((r) => selectedProdutos.includes(r.produto)) : rowsPorGrupo),
    [rowsPorGrupo, selectedProdutos]
  );
  const tamanhoAgg = useMemo(() => aggregate(rowsPorProduto, (r) => r.tamanho), [rowsPorProduto]);

  function toggleGrupo(key: string) {
    setSelectedGrupos((cur) => (cur.includes(key) ? cur.filter((g) => g !== key) : [...cur, key]));
    setSelectedProdutos([]);
  }
  function toggleProduto(key: string) {
    setSelectedProdutos((cur) => (cur.includes(key) ? cur.filter((p) => p !== key) : [...cur, key]));
  }

  const giroFiltrado = selectedGrupos.length > 0 ? giroPorGrupo.filter((g) => selectedGrupos.includes(g.key)) : giroPorGrupo;

  return (
    <div className="flex flex-col gap-3">
      {(selectedGrupos.length > 0 || selectedProdutos.length > 0) && (
        <button
          type="button"
          onClick={() => {
            setSelectedGrupos([]);
            setSelectedProdutos([]);
          }}
          className="w-fit rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1 text-xs text-[var(--series-1)] hover:bg-[var(--page-plane)]"
        >
          Limpar seleção
        </button>
      )}

      <div className="mb-1 flex items-center gap-4 text-xs text-[var(--text-secondary)]">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COR_ESTOQUE }} />
          Estoque atual
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COR_VENDIDO }} />
          Vendido no período (líquido)
        </span>
        <span className="text-[var(--text-muted)]">Clique numa barra pra filtrar os painéis à direita.</span>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <div className="lg:col-span-1">
          <Panel title="Grupo" items={grupoAgg} selected={selectedGrupos} onToggle={toggleGrupo} emptyMessage="Sem dados." />
        </div>
        <div className="lg:col-span-1">
          <Panel title="Produto" items={produtoAgg} selected={selectedProdutos} onToggle={toggleProduto} emptyMessage="Sem dados." />
        </div>
        <div className="lg:col-span-1">
          <Panel title="Tamanho" items={tamanhoAgg} selected={[]} onToggle={() => {}} emptyMessage="Sem dados." />
        </div>
        <div className="lg:col-span-1 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3">
          <h3 className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Giro por grupo</h3>
          <p className="mb-2 text-[10px] text-[var(--text-muted)]">Vendido / produzido (ou / estoque quando não há produção registrada) — histórico completo, não muda com filtro de período/loja.</p>
          <div className="flex max-h-[480px] flex-col gap-1 overflow-y-auto text-xs">
            {[...giroFiltrado]
              .sort((a, b) => (b.sellThroughRate ?? 0) - (a.sellThroughRate ?? 0))
              .map((g) => (
                <div key={g.key} className="flex items-center justify-between gap-2 border-b border-[var(--gridline)] py-1 last:border-0">
                  <span className="truncate text-[var(--text-secondary)]">{g.key}</span>
                  <span className="shrink-0 tabular-nums font-medium text-[var(--text-primary)]">
                    {g.sellThroughRate === null ? "—" : `${g.sellThroughRate.toFixed(0)}%`}
                  </span>
                </div>
              ))}
            {giroFiltrado.length === 0 && <p className="text-center text-[var(--text-muted)]">Sem dados.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
