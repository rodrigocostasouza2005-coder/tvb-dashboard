import type { ItemMinimoEmpresarial } from "@/lib/metrics";
import { formatNumero, NIVEL_COR } from "./format";

type ProdutoAgregado = {
  produto: string;
  grupo: string;
  criticos: number;
  atencoes: number;
  normais: number;
  semMinimo: number;
  total: number;
};

// Agregação puramente de apresentação (1 linha por produto, contando tamanhos por nível) — não é
// lógica de negócio nova, só agrupa o que getEstoqueMinimoEmpresarial já calculou por cod/tamanho.
function agregarPorProduto(itens: ItemMinimoEmpresarial[]): ProdutoAgregado[] {
  const porProduto = new Map<string, ProdutoAgregado>();
  for (const item of itens) {
    let acc = porProduto.get(item.produto);
    if (!acc) {
      acc = { produto: item.produto, grupo: item.grupo, criticos: 0, atencoes: 0, normais: 0, semMinimo: 0, total: 0 };
      porProduto.set(item.produto, acc);
    }
    acc.total += 1;
    if (item.nivelAlerta === "CRITICO") acc.criticos += 1;
    else if (item.nivelAlerta === "ATENCAO") acc.atencoes += 1;
    else if (item.nivelAlerta === "NORMAL") acc.normais += 1;
    else acc.semMinimo += 1;
  }
  return [...porProduto.values()].sort(
    (a, b) => b.criticos - a.criticos || b.atencoes - a.atencoes || a.produto.localeCompare(b.produto, "pt-BR")
  );
}

// Server component — abrir um produto navega pra ?produto=<nome> (mesma página, preservando os
// outros filtros via querystring), mesmo padrão de planejamento-estoque/produtos-table.tsx.
export function ProdutosConsolidadoTable({
  itens,
  basePath,
  queryString,
  produtoAberto,
}: {
  itens: ItemMinimoEmpresarial[];
  basePath: string;
  queryString: string;
  produtoAberto?: string;
}) {
  const rows = agregarPorProduto(itens);

  function hrefProduto(produto: string) {
    const qs = new URLSearchParams(queryString);
    qs.set("produto", produto);
    return `${basePath}?${qs.toString()}`;
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-6 text-center text-sm text-[var(--text-muted)]">
        Nenhum produto Best Seller encontrado para os filtros selecionados.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Produto</th>
            <th className="px-4 py-2 font-medium">Grupo</th>
            <th className="px-4 py-2 font-medium text-right">Tamanhos</th>
            <th className="px-4 py-2 font-medium text-right">Crítico</th>
            <th className="px-4 py-2 font-medium text-right">Atenção</th>
            <th className="px-4 py-2 font-medium text-right">Normal</th>
            <th className="px-4 py-2 font-medium text-right">Sem mínimo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = r.produto === produtoAberto;
            return (
              <tr
                key={r.produto}
                className={`border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)] ${isOpen ? "bg-[var(--page-plane)]" : ""}`}
              >
                <td className="px-4 py-2 font-medium text-[var(--text-primary)]">
                  <a href={hrefProduto(r.produto)} className="hover:underline">
                    {r.produto}
                  </a>
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{r.grupo}</td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">{formatNumero(r.total)}</td>
                <td className="px-4 py-2 tabular-nums text-right font-medium" style={{ color: r.criticos > 0 ? NIVEL_COR.CRITICO : undefined }}>
                  {r.criticos > 0 ? formatNumero(r.criticos) : "—"}
                </td>
                <td className="px-4 py-2 tabular-nums text-right font-medium" style={{ color: r.atencoes > 0 ? NIVEL_COR.ATENCAO : undefined }}>
                  {r.atencoes > 0 ? formatNumero(r.atencoes) : "—"}
                </td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                  {r.normais > 0 ? formatNumero(r.normais) : "—"}
                </td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-muted)]">
                  {r.semMinimo > 0 ? formatNumero(r.semMinimo) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
