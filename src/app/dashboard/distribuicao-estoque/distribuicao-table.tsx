import type { ComparacaoVariante } from "@/lib/metrics";
import { diagnosticoInfo, formatNumero } from "./format";

// Uma tabela por produto, uma linha por variante (cor/tamanho), uma coluna "Estoque" + uma
// coluna "Diagnóstico" por loja — substitui as mini-tabelas por variante (que exigiam clicar
// pra abrir o produto e depois ler uma tabela separada por SKU) por uma visão única, sempre
// visível, scanneável sem nenhum clique (pedido do Rodrigo em 2026-11-02). Detalhe fino
// (vendas 30/60/90d, cobertura em dias) vai pro atributo title (tooltip nativo) do badge de
// diagnóstico de cada loja, em vez de ocupar coluna própria.
function tituloDiagnostico(l: ComparacaoVariante["porLoja"][number]): string {
  return `Cobertura: ${formatNumero(l.coberturaDias, 1)} dias · Vendas 30/60/90d: ${formatNumero(l.vendasDias30)}/${formatNumero(l.vendasDias60)}/${formatNumero(l.vendasDias90)}`;
}

// Cada produto é um <details> nativo (0 JS novo) — ABERTO por padrão só quando tem variante em
// ruptura/cobertura crítica (o que precisa de atenção já aparece pronto pra ler), FECHADO por
// padrão nos demais. Antes, TODOS os produtos do filtro vinham sempre abertos como tabelas
// completas empilhadas verticalmente — numa base com dezenas/centenas de produtos isso virava uma
// parede de rolagem sem nenhuma hierarquia (achado real: "o layout está me incomodando muito",
// Rodrigo 2026-11-24). Mesmo padrão já usado em "Mantido" (distribuicao-estoque/movimentacoes.tsx)
// e nas seções de premissas/avisos do Mapa de Compras.
function ProdutoTabela({ produto, variantes }: { produto: string; variantes: ComparacaoVariante[] }) {
  const comDesequilibrio = variantes.filter((v) =>
    v.porLoja.some((l) => l.diagnostico === "ruptura" || l.diagnostico === "cobertura_critica")
  ).length;
  const precisaAtencao = comDesequilibrio > 0;

  // Lojas na ordem em que já vêm do backend (consistente, ver porLoja) — colunas derivadas
  // dinamicamente, nunca hardcoded, pra não quebrar se a lista de lojas mudar.
  const lojas: { storeId: string; storeName: string }[] = [];
  const vistos = new Set<string>();
  for (const v of variantes) {
    for (const l of v.porLoja) {
      if (!vistos.has(l.storeId)) {
        vistos.add(l.storeId);
        lojas.push({ storeId: l.storeId, storeName: l.storeName });
      }
    }
  }

  return (
    <details className="group border-b border-[var(--gridline)] last:border-0" open={precisaAtencao}>
      <summary className="flex w-full cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-[var(--page-plane)] [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
          <span aria-hidden className="inline-block shrink-0 text-[var(--text-muted)] transition-transform group-open:rotate-90">
            ▸
          </span>
          {produto}
          <span className="text-xs font-normal text-[var(--text-muted)]">
            ({variantes.length} variante{variantes.length > 1 ? "s" : ""})
          </span>
        </span>
        {precisaAtencao && (
          <span
            className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: "color-mix(in srgb, var(--status-critical) 15%, transparent)", color: "var(--status-critical)" }}
          >
            {comDesequilibrio} com ruptura/cobertura crítica
          </span>
        )}
      </summary>
      <div className="overflow-x-auto px-4 pb-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] text-left text-[var(--text-muted)]">
              <th className="px-3 py-1.5 font-medium whitespace-nowrap">Variante</th>
              {lojas.map((loja) => (
                <th key={loja.storeId} className="px-3 py-1.5 text-right font-medium whitespace-nowrap" colSpan={2}>
                  {loja.storeName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {variantes.map((v) => (
              <tr key={v.cod} className="border-b border-[var(--gridline)] last:border-0">
                <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-secondary)]">
                  {v.cor ?? "—"} · {v.tamanho ?? "—"} <span className="text-[var(--text-muted)]">({v.cod})</span>
                </td>
                {lojas.map((loja) => {
                  const l = v.porLoja.find((x) => x.storeId === loja.storeId);
                  if (!l) {
                    return (
                      <td key={loja.storeId} className="px-3 py-1.5 text-right text-[var(--text-muted)]" colSpan={2}>
                        —
                      </td>
                    );
                  }
                  const info = diagnosticoInfo(l.diagnostico);
                  // "equilibrado"/"sem_dado" são o caso NORMAL/sem informação útil (achado real:
                  // ~75% das células do catálogo inteiro caem num dos dois) — badge colorido pros
                  // dois só adicionava ruído visual sem avisar de nada que precise de atenção.
                  // Detalhe completo continua no tooltip (title), só a exibição inline encolhe.
                  const neutro = l.diagnostico === "equilibrado" || l.diagnostico === "sem_dado";
                  return (
                    <td key={loja.storeId} className="px-3 py-1.5 text-right" colSpan={2}>
                      <span className="inline-flex items-center justify-end gap-3 whitespace-nowrap">
                        <span className="tabular-nums">{formatNumero(l.estoqueAtual)}</span>
                        {neutro ? (
                          <span className="text-[var(--text-muted)]" title={tituloDiagnostico(l)}>
                            {l.diagnostico === "sem_dado" ? "—" : "ok"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5" title={tituloDiagnostico(l)}>
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: info.color }} />
                            {info.label}
                          </span>
                        )}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
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
        Nenhum produto encontrado no filtro atual — verifique se há pelo menos 2 posições de estoque
        comerciais (lojas de varejo ou CD/Site) liberadas pra este usuário.
      </div>
    );
  }

  const comAtencao = produtos.filter(([, vs]) =>
    vs.some((v) => v.porLoja.some((l) => l.diagnostico === "ruptura" || l.diagnostico === "cobertura_critica"))
  ).length;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gridline)] px-4 py-2 text-[11px] text-[var(--text-muted)]">
        <span>
          {produtos.length} produto{produtos.length > 1 ? "s" : ""} no filtro
          {comAtencao > 0 && ` · ${comAtencao} já aberto(s) por ter ruptura/cobertura crítica`}
        </span>
        <span>Clique no nome do produto pra abrir/fechar o detalhe</span>
      </div>
      {produtos.map(([produto, vs]) => (
        <ProdutoTabela key={produto} produto={produto} variantes={vs} />
      ))}
    </div>
  );
}
