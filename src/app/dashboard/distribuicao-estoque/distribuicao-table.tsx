"use client";

import { useState } from "react";
import type { ComparacaoVariante, VariantePorLoja } from "@/lib/metrics";
import { diagnosticoInfo, formatNumero } from "./format";

function VarianteTabela({ v }: { v: ComparacaoVariante }) {
  const linhas: { label: string; render: (l: VariantePorLoja) => string }[] = [
    { label: "Estoque atual", render: (l) => formatNumero(l.estoqueAtual) },
    { label: "Vendas 30 dias", render: (l) => formatNumero(l.vendasDias30) },
    { label: "Vendas 60 dias", render: (l) => formatNumero(l.vendasDias60) },
    { label: "Vendas 90 dias", render: (l) => formatNumero(l.vendasDias90) },
    { label: "Cobertura (dias)", render: (l) => formatNumero(l.coberturaDias, 1) },
  ];

  return (
    <div className="overflow-x-auto rounded-md border border-[var(--border)]">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] text-left text-[var(--text-muted)]">
            <th className="px-3 py-1.5 font-medium whitespace-nowrap">
              {v.cor ?? "—"} · {v.tamanho ?? "—"} <span className="text-[var(--text-muted)]">({v.cod})</span>
            </th>
            {v.porLoja.map((l) => (
              <th key={l.storeId} className="px-3 py-1.5 text-right font-medium whitespace-nowrap">
                {l.storeName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr key={linha.label} className="border-b border-[var(--gridline)] last:border-0">
              <td className="px-3 py-1.5 text-[var(--text-secondary)] whitespace-nowrap">{linha.label}</td>
              {v.porLoja.map((l) => (
                <td key={l.storeId} className="px-3 py-1.5 text-right tabular-nums">
                  {linha.render(l)}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td className="px-3 py-1.5 text-[var(--text-secondary)] whitespace-nowrap">Diagnóstico</td>
            {v.porLoja.map((l) => {
              const info = diagnosticoInfo(l.diagnostico);
              return (
                <td key={l.storeId} className="px-3 py-1.5 text-right">
                  <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: info.color }} />
                    {info.label}
                  </span>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// Mesmo idioma de expand/collapse já usado em mapa-compras-grid.tsx (GrupoBloco) e
// inteligencia/tabelas.tsx (GrupoLinha) — useState boolean + ▸ rotacionado, reimplementado aqui
// (não extraído pra componente compartilhado, consistente com o que as outras duas telas já
// fazem: ver auditoria de padrões de UI, cada tabela expansível reimplementa o idioma).
function ProdutoBloco({ produto, variantes }: { produto: string; variantes: ComparacaoVariante[] }) {
  const [aberto, setAberto] = useState(false);
  const comDesequilibrio = variantes.filter((v) =>
    v.porLoja.some((l) => l.diagnostico === "ruptura" || l.diagnostico === "cobertura_critica")
  ).length;

  return (
    <div className="border-b border-[var(--gridline)] last:border-0">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-[var(--page-plane)]"
      >
        <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
          <span
            className="inline-block w-3 text-[var(--text-muted)] transition-transform"
            style={{ transform: aberto ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            ▸
          </span>
          {produto}
          <span className="text-xs font-normal text-[var(--text-muted)]">
            ({variantes.length} variante{variantes.length > 1 ? "s" : ""})
          </span>
        </span>
        {comDesequilibrio > 0 && (
          <span
            className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: "color-mix(in srgb, var(--status-critical) 15%, transparent)", color: "var(--status-critical)" }}
          >
            {comDesequilibrio} com ruptura/cobertura crítica
          </span>
        )}
      </button>
      {aberto && (
        <div className="space-y-3 px-4 pb-3">
          {variantes.map((v) => (
            <VarianteTabela key={v.cod} v={v} />
          ))}
        </div>
      )}
    </div>
  );
}

export function DistribuicaoTable({ variantes }: { variantes: ComparacaoVariante[] }) {
  const porProduto = new Map<string, ComparacaoVariante[]>();
  for (const v of variantes) {
    const arr = porProduto.get(v.produto) ?? [];
    arr.push(v);
    porProduto.set(v.produto, arr);
  }
  const produtos = [...porProduto.entries()];

  if (produtos.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-6 text-center text-sm text-[var(--text-muted)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        Nenhum produto encontrado no filtro atual — verifique se há pelo menos 2 das lojas físicas
        (Leblon, Barra, Rio Sul) liberadas pra este usuário.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {produtos.map(([produto, vs]) => (
        <ProdutoBloco key={produto} produto={produto} variantes={vs} />
      ))}
    </div>
  );
}
