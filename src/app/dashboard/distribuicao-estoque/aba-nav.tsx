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
    // Sublinhado (border-b-2), não mais o "pill" preenchido antigo — unifica com o padrão de aba
    // interna já usado em planejamento-estoque/produto-aba-nav.tsx (reformulação 2026-11-23) e com
    // o TabNav global (dashboard/tab-nav.tsx): a mesma linguagem visual de navegação em toda a tela,
    // em vez de dois estilos de "aba" diferentes convivendo no mesmo produto.
    <div className="mb-4 flex flex-wrap gap-1 border-b border-[var(--gridline)]" role="tablist">
      {ABAS.map((aba) => (
        <Link
          key={aba.value}
          href={hrefComAba(basePath, searchParams, aba.value)}
          scroll={false}
          role="tab"
          aria-selected={atual === aba.value}
          className={`border-b-2 px-3 py-2 text-xs font-medium ${
            atual === aba.value
              ? "border-[var(--series-1)] text-[var(--text-primary)]"
              : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          {aba.label}
        </Link>
      ))}
    </div>
  );
}
