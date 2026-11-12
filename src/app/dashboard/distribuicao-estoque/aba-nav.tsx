import Link from "next/link";
import type { RawSearchParams } from "@/lib/filters";

// 4 abas na MESMA tela (pedido do Rodrigo, 2026-11-11: não criar módulo/rota separada). Estado da
// aba vive no searchParam `aba`, não em useState — assim um link/F5 preserva a aba E os filtros,
// e cada aba continua sendo renderizada no servidor (nenhuma delas precisa baixar o dado das
// outras 3). Mesmo visual do DimensionToggle já usado nas outras telas.
export const ABAS = [
  { value: "visao-geral", label: "Visão Geral" },
  { value: "movimentacoes", label: "Movimentações" },
  { value: "grade", label: "Análise de Grade" },
  { value: "historico", label: "Histórico" },
] as const;

export type AbaDistribuicao = (typeof ABAS)[number]["value"];

export function parseAba(raw: string | string[] | undefined): AbaDistribuicao {
  const v = typeof raw === "string" ? raw : "";
  return (ABAS as readonly { value: string }[]).some((a) => a.value === v) ? (v as AbaDistribuicao) : "visao-geral";
}

export function hrefComAba(basePath: string, searchParams: RawSearchParams, aba: AbaDistribuicao) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "aba" || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else qs.append(key, value);
  }
  qs.set("aba", aba);
  return `${basePath}?${qs.toString()}`;
}

export function AbaNav({
  basePath,
  searchParams,
  atual,
}: {
  basePath: string;
  searchParams: RawSearchParams;
  atual: AbaDistribuicao;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-[var(--gridline)] pb-2" role="tablist">
      {ABAS.map((aba) => (
        <Link
          key={aba.value}
          href={hrefComAba(basePath, searchParams, aba.value)}
          scroll={false}
          role="tab"
          aria-selected={atual === aba.value}
          className={`rounded-md px-3 py-1.5 text-xs font-medium ${
            atual === aba.value
              ? "bg-[var(--series-1)] text-white"
              : "border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-1)]"
          }`}
        >
          {aba.label}
        </Link>
      ))}
    </div>
  );
}
