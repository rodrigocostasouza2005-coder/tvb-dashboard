import type { ProdutoPlanejamento } from "@/lib/metrics";
import { formatNumber, SITUACAO_LABEL, SITUACAO_COR, CLASSIFICACAO_LABEL, TENDENCIA_LABEL, TENDENCIA_COR } from "./format";

// Server component — abrir um produto navega pra ?produto=<nome> (mesma página, preservando os
// outros filtros via querystring), sem precisar de fetch client nem rota de API nova.
export function ProdutosTable({
  rows,
  basePath,
  queryString,
  produtoAberto,
}: {
  rows: ProdutoPlanejamento[];
  basePath: string;
  queryString: string;
  produtoAberto?: string;
}) {
  function hrefProduto(produto: string) {
    const qs = new URLSearchParams(queryString);
    qs.set("produto", produto);
    return `${basePath}?${qs.toString()}`;
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-6 text-center text-sm text-[var(--text-muted)]">
        Nenhum produto encontrado para os filtros selecionados.
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
            <th className="px-4 py-2 font-medium">Classificação</th>
            <th className="px-4 py-2 font-medium text-right">Estoque total</th>
            <th className="px-4 py-2 font-medium text-right">CD/Site</th>
            <th className="px-4 py-2 font-medium text-right">Lojas</th>
            <th className="px-4 py-2 font-medium text-right">Vendas 30d</th>
            <th className="px-4 py-2 font-medium text-right">Vendas 60d</th>
            <th className="px-4 py-2 font-medium text-right">Vendas 90d</th>
            <th className="px-4 py-2 font-medium">Tendência</th>
            <th className="px-4 py-2 font-medium text-right">Vel. diária</th>
            <th className="px-4 py-2 font-medium text-right">Cobertura</th>
            <th className="px-4 py-2 font-medium">Situação</th>
            <th className="px-4 py-2 font-medium text-right">Em trânsito</th>
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
                <td className="px-4 py-2 text-[var(--text-secondary)]">{CLASSIFICACAO_LABEL[r.classificacao]}</td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(r.estoqueTotal)}</td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(r.estoqueCD)}</td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(r.estoqueLojas)}</td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(r.vendasDias30)}</td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(r.vendasDias60)}</td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">{formatNumber(r.vendasDias90)}</td>
                <td className={`px-4 py-2 font-medium ${TENDENCIA_COR[r.tendencia]}`}>{TENDENCIA_LABEL[r.tendencia]}</td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                  {r.confiavel ? r.velocidadeDiaria.toFixed(2) : "—"}
                </td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                  {r.coberturaDias != null ? `${r.coberturaDias.toFixed(0)}d` : "Dados insuficientes"}
                </td>
                <td className={`px-4 py-2 font-medium ${SITUACAO_COR[r.situacao]}`}>
                  {SITUACAO_LABEL[r.situacao]}
                  {r.demandaPossivelmenteMascarada && (
                    <span
                      className="ml-1 text-[var(--text-muted)]"
                      title="Estoque crítico/zerado — a venda observada pode estar subestimando a demanda real, não necessariamente falta de interesse."
                    >
                      ⚠
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                  {r.quantidadeEmTransito > 0 ? (
                    <span title="Sem data de chegada confiável — ver detalhe do produto">
                      {formatNumber(r.quantidadeEmTransito)} (não confirmado)
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
