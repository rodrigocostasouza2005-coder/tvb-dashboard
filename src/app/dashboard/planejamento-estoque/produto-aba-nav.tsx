import Link from "next/link";
import type { RawSearchParams } from "@/lib/filters";

// Reformulação do Planejamento de Estoque (2026-11-23) — Zona 3 do pedido do Rodrigo: "NÃO
// empilhar tudo num scroll. Organizar em abas internas." Mesmo padrão já estabelecido em
// distribuicao-estoque/aba-nav.tsx (estado da aba no searchParam `aba`, nunca em useState —
// preserva ao dar F5/compartilhar link, cada aba renderiza no servidor). Arquivo próprio em vez de
// reaproveitar o de distribuicao-estoque de propósito: evita tocar um módulo fora do escopo desta
// missão só por DRY de ~20 linhas de JSX de navegação.
export const PRODUTO_ABAS = [
  { value: "geral", label: "Visão Geral" },
  { value: "grade", label: "Grade" },
  { value: "distribuicao", label: "Distribuição" },
  { value: "reposicao", label: "Reposição e Compras" },
  { value: "decisoes", label: "Decisões e Ações" },
] as const;

export type ProdutoAba = (typeof PRODUTO_ABAS)[number]["value"];

export function parseProdutoAba(raw: string | string[] | undefined): ProdutoAba {
  const v = typeof raw === "string" ? raw : "";
  return (PRODUTO_ABAS as readonly { value: string }[]).some((a) => a.value === v) ? (v as ProdutoAba) : "geral";
}

// Preserva TODOS os outros parâmetros (grupo/tamanho/busca/produto/situacao/sort/dir) — só troca
// `aba`. É assim que "manter seleção de produto e filtros ao navegar entre abas" (pedido explícito)
// é garantido sem estado client nenhum.
export function hrefComProdutoAba(basePath: string, searchParams: RawSearchParams, aba: ProdutoAba) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "aba" || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else qs.append(key, value);
  }
  qs.set("aba", aba);
  return `${basePath}?${qs.toString()}`;
}

export function ProdutoAbaNav({
  basePath,
  searchParams,
  atual,
}: {
  basePath: string;
  searchParams: RawSearchParams;
  atual: ProdutoAba;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-[var(--gridline)] px-4 pt-2" role="tablist">
      {PRODUTO_ABAS.map((aba) => (
        <Link
          key={aba.value}
          href={hrefComProdutoAba(basePath, searchParams, aba.value)}
          scroll={false}
          role="tab"
          aria-selected={atual === aba.value}
          className={`rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium ${
            atual === aba.value
              ? "border-[var(--series-1)] text-[var(--text-primary)]"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          {aba.label}
        </Link>
      ))}
    </div>
  );
}
