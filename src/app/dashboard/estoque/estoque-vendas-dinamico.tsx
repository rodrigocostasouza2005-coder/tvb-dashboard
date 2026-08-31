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
  // Sem estoque e sem venda no período não tem o que mostrar — pedido do Rodrigo em 2026-08-31.
  return [...map.values()]
    .filter((i) => i.currentStock !== 0 || i.unitsSold !== 0)
    .sort((a, b) => b.unitsSold - a.unitsSold);
}

function BarRow({ item, max, selected, onClick }: { item: Agg; max: number; selected: boolean; onClick: () => void }) {
  const pctEstoque = max > 0 ? Math.min(100, (Math.max(0, item.currentStock) / max) * 100) : 0;
  const pctVendido = max > 0 ? Math.min(100, (Math.max(0, item.unitsSold) / max) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-md px-3 py-2 text-left transition-colors ${
        selected ? "bg-[var(--page-plane)] ring-1 ring-[var(--series-1)]" : "hover:bg-[var(--page-plane)]"
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
        <span className="truncate font-medium text-[var(--text-primary)]">{item.key}</span>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="h-2.5 flex-1 rounded-full bg-[var(--gridline)]">
            <div className="h-2.5 rounded-full" style={{ width: `${pctEstoque}%`, backgroundColor: COR_ESTOQUE }} />
          </div>
          <span className="w-14 shrink-0 text-right text-xs tabular-nums text-[var(--text-muted)]">{item.currentStock.toLocaleString("pt-BR")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2.5 flex-1 rounded-full bg-[var(--gridline)]">
            <div className="h-2.5 rounded-full" style={{ width: `${pctVendido}%`, backgroundColor: COR_VENDIDO }} />
          </div>
          <span className="w-14 shrink-0 text-right text-xs tabular-nums text-[var(--text-muted)]">{item.unitsSold.toLocaleString("pt-BR")}</span>
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
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">{title}</h3>
        {selected.length > 0 && (
          <span className="text-[11px] text-[var(--text-muted)]">{selected.length} selecionado{selected.length > 1 ? "s" : ""}</span>
        )}
      </div>
      <div className="flex max-h-[calc(100vh-260px)] min-h-[400px] flex-col gap-1 overflow-y-auto">
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
}: {
  rows: Row[];
}) {
  const [selectedGrupos, setSelectedGrupos] = useState<string[]>([]);
  const [selectedProdutos, setSelectedProdutos] = useState<string[]>([]);
  const [selectedTamanhos, setSelectedTamanhos] = useState<string[]>([]);

  // Cross-filter nos 3 juntos, tipo Power BI: cada painel reflete a seleção dos OUTROS dois, mas
  // nunca a própria (senão selecionar algo faria o próprio painel murchar pra só aquele item) —
  // pedido do Rodrigo em 2026-08-31.
  function applyFilters(exclude: "grupo" | "produto" | "tamanho") {
    return rows.filter(
      (r) =>
        (exclude === "grupo" || selectedGrupos.length === 0 || selectedGrupos.includes(r.grupo)) &&
        (exclude === "produto" || selectedProdutos.length === 0 || selectedProdutos.includes(r.produto)) &&
        (exclude === "tamanho" || selectedTamanhos.length === 0 || selectedTamanhos.includes(r.tamanho))
    );
  }

  const grupoAgg = useMemo(
    () => aggregate(applyFilters("grupo"), (r) => r.grupo),
    [rows, selectedProdutos, selectedTamanhos]
  );
  const produtoAgg = useMemo(
    () => aggregate(applyFilters("produto"), (r) => r.produto),
    [rows, selectedGrupos, selectedTamanhos]
  );
  const tamanhoAgg = useMemo(
    () => aggregate(applyFilters("tamanho"), (r) => r.tamanho),
    [rows, selectedGrupos, selectedProdutos]
  );

  function toggleGrupo(key: string) {
    setSelectedGrupos((cur) => (cur.includes(key) ? cur.filter((g) => g !== key) : [...cur, key]));
  }
  function toggleProduto(key: string) {
    setSelectedProdutos((cur) => (cur.includes(key) ? cur.filter((p) => p !== key) : [...cur, key]));
  }
  function toggleTamanho(key: string) {
    setSelectedTamanhos((cur) => (cur.includes(key) ? cur.filter((t) => t !== key) : [...cur, key]));
  }

  return (
    <div className="flex flex-col gap-3">
      {(selectedGrupos.length > 0 || selectedProdutos.length > 0 || selectedTamanhos.length > 0) && (
        <button
          type="button"
          onClick={() => {
            setSelectedGrupos([]);
            setSelectedProdutos([]);
            setSelectedTamanhos([]);
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
        <span className="text-[var(--text-muted)]">Clique numa barra de Grupo, Produto ou Tamanho pra filtrar os outros painéis.</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Grupo" items={grupoAgg} selected={selectedGrupos} onToggle={toggleGrupo} emptyMessage="Sem dados." />
        <Panel title="Produto" items={produtoAgg} selected={selectedProdutos} onToggle={toggleProduto} emptyMessage="Sem dados." />
        <Panel title="Tamanho" items={tamanhoAgg} selected={selectedTamanhos} onToggle={toggleTamanho} emptyMessage="Sem dados." />
      </div>
    </div>
  );
}
