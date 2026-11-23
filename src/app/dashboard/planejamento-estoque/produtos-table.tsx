import type { ProdutoPlanejamento, Diagnostico } from "@/lib/metrics";
import { formatNumber, SITUACAO_LABEL, SITUACAO_COR, CLASSIFICACAO_LABEL, TENDENCIA_LABEL, TENDENCIA_COR } from "./format";

// Zona 2 — Lista/Priorização de produtos (pedido do Rodrigo: "tabela enxuta e utilizável... com
// busca/filtro/ordenação/priorização"). `sort`/`dir` vivem no searchParam (nunca em estado client),
// mesma convenção de `aba`/`situacao` — F5 ou link direto preserva a ordenação escolhida.
export type SortKey = "produto" | "estoqueTotal" | "vendasDias90" | "coberturaDias" | "situacao";
export type SortDir = "asc" | "desc";

const SORT_KEYS_VALIDOS: SortKey[] = ["produto", "estoqueTotal", "vendasDias90", "coberturaDias", "situacao"];
export function parseSortKey(raw: string): SortKey {
  return (SORT_KEYS_VALIDOS as string[]).includes(raw) ? (raw as SortKey) : "produto";
}

// Prioridade de leitura, não ordem alfabética: o que exige ação primeiro. Usada só quando
// sort="situacao" — nunca influencia nenhum cálculo, é puramente de exibição.
const PRIORIDADE_SITUACAO: Record<Diagnostico, number> = {
  ruptura: 0,
  cobertura_critica: 1,
  estoque_parado: 2,
  lancamento_recente: 3,
  cobertura_excessiva: 4,
  equilibrado: 5,
  sem_dado: 6,
};

// Pura — testável sem servidor/React. Null sempre por último, qualquer que seja a direção (nunca
// confundido com "pior valor" ou "melhor valor").
export function ordenarProdutos(rows: ProdutoPlanejamento[], sort: SortKey, dir: SortDir): ProdutoPlanejamento[] {
  const mult = dir === "desc" ? -1 : 1;
  const comparar = (a: ProdutoPlanejamento, b: ProdutoPlanejamento): number => {
    switch (sort) {
      case "estoqueTotal":
        return (a.estoqueTotal - b.estoqueTotal) * mult;
      case "vendasDias90":
        return (a.vendasDias90 - b.vendasDias90) * mult;
      case "coberturaDias": {
        if (a.coberturaDias == null && b.coberturaDias == null) return 0;
        if (a.coberturaDias == null) return 1; // null sempre por último
        if (b.coberturaDias == null) return -1;
        return (a.coberturaDias - b.coberturaDias) * mult;
      }
      case "situacao":
        return (PRIORIDADE_SITUACAO[a.situacao] - PRIORIDADE_SITUACAO[b.situacao]) * mult;
      default:
        return a.produto.localeCompare(b.produto, "pt-BR") * mult;
    }
  };
  return [...rows].sort((a, b) => comparar(a, b) || a.produto.localeCompare(b.produto, "pt-BR"));
}

function SortHeader({
  label,
  sortKey,
  basePath,
  queryString,
  produtoAberto,
  sortAtual,
  dirAtual,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  basePath: string;
  queryString: string;
  produtoAberto?: string;
  sortAtual: SortKey;
  dirAtual: SortDir;
  align?: "left" | "right";
}) {
  const ativo = sortAtual === sortKey;
  const novoDir: SortDir = ativo && dirAtual === "asc" ? "desc" : "asc";
  const qs = new URLSearchParams(queryString);
  if (produtoAberto) qs.set("produto", produtoAberto);
  qs.set("sort", sortKey);
  qs.set("dir", novoDir);
  return (
    <th className={`px-4 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <a href={`${basePath}?${qs.toString()}`} className="inline-flex items-center gap-1 hover:text-[var(--text-secondary)]">
        {label}
        {ativo && <span aria-hidden>{dirAtual === "asc" ? "▲" : "▼"}</span>}
      </a>
    </th>
  );
}

// Server component — abrir um produto navega pra ?produto=<nome> (mesma página, preservando os
// outros filtros via querystring), sem precisar de fetch client nem rota de API nova.
export function ProdutosTable({
  rows,
  basePath,
  queryString,
  produtoAberto,
  sort,
  dir,
}: {
  rows: ProdutoPlanejamento[];
  basePath: string;
  queryString: string;
  produtoAberto?: string;
  sort: SortKey;
  dir: SortDir;
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

  const sortHeaderProps = { basePath, queryString, produtoAberto, sortAtual: sort, dirAtual: dir };

  return (
    <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <SortHeader label="Produto" sortKey="produto" {...sortHeaderProps} />
            <th className="px-4 py-2 font-medium">Grupo</th>
            <th className="px-4 py-2 font-medium">Classificação</th>
            <SortHeader label="Estoque total" sortKey="estoqueTotal" align="right" {...sortHeaderProps} />
            <th className="px-4 py-2 font-medium text-right">CD/Site</th>
            <th className="px-4 py-2 font-medium text-right">Lojas</th>
            <th className="px-4 py-2 font-medium text-right">Vendas 30d</th>
            <th className="px-4 py-2 font-medium text-right">Vendas 60d</th>
            <SortHeader label="Vendas 90d" sortKey="vendasDias90" align="right" {...sortHeaderProps} />
            <th className="px-4 py-2 font-medium">Tendência</th>
            <th className="px-4 py-2 font-medium text-right">Vel. diária</th>
            <SortHeader label="Cobertura" sortKey="coberturaDias" align="right" {...sortHeaderProps} />
            <SortHeader label="Situação" sortKey="situacao" {...sortHeaderProps} />
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
                    <span title="Sem data de chegada confiável — ver aba Reposição e Compras">
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
