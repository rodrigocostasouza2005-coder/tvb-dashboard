"use client";

import { Fragment, useState } from "react";
import { corCelula } from "@/lib/cohort-color";

export type CohortGradeRow = {
  key: string;
  primeiraVenda: string;
  totalHoje: number;
  celulas: (number | null)[];
};

function formatDataBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Tabela de cohort (Curva de Vida da Coleção) expansível em 3 níveis: Coleção → Grupo → Produto.
// grupoGrid/produtoGrid já vêm 100% calculados do server (mesma janela/visão/filtros da linha de
// Coleção) — aqui só controla o que fica VISÍVEL (chevron independente por linha), sem nenhum
// fetch adicional. Pedido do Rodrigo em 2026-09-23: cada nível com curva de vida própria (D0 e
// base do % são do nível, não da coleção), sem alterar cálculo/layout/filtros existentes.
export function CohortTable({
  colecaoRows,
  grupoGrid,
  produtoGrid,
  colunaLabels,
  maxValor,
}: {
  colecaoRows: CohortGradeRow[];
  grupoGrid: Record<string, CohortGradeRow[]>;
  produtoGrid: Record<string, CohortGradeRow[]>;
  colunaLabels: string[];
  maxValor: number;
}) {
  const [openColecoes, setOpenColecoes] = useState<Set<string>>(new Set());
  const [openGrupos, setOpenGrupos] = useState<Set<string>>(new Set());

  function toggleColecao(colecao: string) {
    setOpenColecoes((prev) => {
      const next = new Set(prev);
      if (next.has(colecao)) next.delete(colecao);
      else next.add(colecao);
      return next;
    });
  }

  function toggleGrupo(grupoKey: string) {
    setOpenGrupos((prev) => {
      const next = new Set(prev);
      if (next.has(grupoKey)) next.delete(grupoKey);
      else next.add(grupoKey);
      return next;
    });
  }

  function celulas(valores: (number | null)[]) {
    return valores.map((valor, i) => {
      const { bg, fg } = corCelula(valor, maxValor);
      return (
        <td key={i} className="w-11 px-1 py-2 text-center tabular-nums" style={{ backgroundColor: bg, color: fg }}>
          {valor !== null ? valor.toFixed(0) : ""}
        </td>
      );
    });
  }

  return (
    <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="sticky left-0 z-10 bg-[var(--surface-1)] px-4 py-2 font-medium">Coleção</th>
            <th className="px-3 py-2 font-medium whitespace-nowrap">Lançada em</th>
            {colunaLabels.map((label) => (
              <th key={label} className="w-11 px-1 py-2 text-center font-medium">
                {label}
              </th>
            ))}
            <th className="px-3 py-2 font-medium whitespace-nowrap">Total hoje</th>
          </tr>
        </thead>
        <tbody>
          {colecaoRows.map((c) => {
            const isOpen = openColecoes.has(c.key);
            const grupos = grupoGrid[c.key] ?? [];
            return (
              <Fragment key={c.key}>
                <tr className="group border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="sticky left-0 z-10 bg-[var(--surface-1)] px-4 py-2 font-medium whitespace-nowrap group-hover:bg-[var(--page-plane)]">
                    <button
                      type="button"
                      onClick={() => toggleColecao(c.key)}
                      className="flex w-full items-center gap-2 text-left disabled:cursor-default"
                      disabled={grupos.length === 0}
                    >
                      <span
                        className="inline-block w-3 shrink-0 text-[var(--text-muted)] transition-transform"
                        style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                      >
                        {grupos.length > 0 ? "▸" : ""}
                      </span>
                      {c.key}
                    </button>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-[var(--text-secondary)]">{formatDataBR(c.primeiraVenda)}</td>
                  {celulas(c.celulas)}
                  <td className="px-3 py-2 tabular-nums font-medium whitespace-nowrap">{c.totalHoje.toFixed(1)}%</td>
                </tr>

                {isOpen &&
                  grupos.map((g) => {
                    const gKey = `${c.key}\x00${g.key}`;
                    const isGrupoOpen = openGrupos.has(gKey);
                    const produtos = produtoGrid[gKey] ?? [];
                    return (
                      <Fragment key={gKey}>
                        <tr className="group border-b border-[var(--gridline)] bg-[var(--page-plane)] last:border-0 hover:bg-[var(--gridline)]">
                          <td className="sticky left-0 z-10 bg-[var(--page-plane)] py-1.5 pr-4 pl-8 whitespace-nowrap group-hover:bg-[var(--gridline)]">
                            <button
                              type="button"
                              onClick={() => toggleGrupo(gKey)}
                              className="flex w-full items-center gap-2 text-left text-[var(--text-secondary)] disabled:cursor-default"
                              disabled={produtos.length === 0}
                            >
                              <span
                                className="inline-block w-3 shrink-0 text-[var(--text-muted)] transition-transform"
                                style={{ transform: isGrupoOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                              >
                                {produtos.length > 0 ? "▸" : ""}
                              </span>
                              {g.key}
                            </button>
                          </td>
                          <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-muted)]">{formatDataBR(g.primeiraVenda)}</td>
                          {celulas(g.celulas)}
                          <td className="px-3 py-1.5 tabular-nums whitespace-nowrap text-[var(--text-secondary)]">
                            {g.totalHoje.toFixed(1)}%
                          </td>
                        </tr>

                        {isGrupoOpen &&
                          produtos.map((p) => (
                            <tr
                              key={`${gKey}\x00${p.key}`}
                              className="group border-b border-[var(--gridline)] bg-[var(--page-plane)] last:border-0"
                            >
                              <td className="sticky left-0 z-10 bg-[var(--page-plane)] py-1 pr-4 pl-14 text-xs whitespace-nowrap text-[var(--text-muted)]">
                                {p.key}
                              </td>
                              <td className="px-3 py-1 text-xs whitespace-nowrap text-[var(--text-muted)]">{formatDataBR(p.primeiraVenda)}</td>
                              {celulas(p.celulas)}
                              <td className="px-3 py-1 text-xs tabular-nums whitespace-nowrap text-[var(--text-muted)]">
                                {p.totalHoje.toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
