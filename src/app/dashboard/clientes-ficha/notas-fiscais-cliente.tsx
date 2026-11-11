"use client";

import { useEffect, useRef, useState } from "react";

export type NotaFiscalRow = {
  storeId: string;
  dapicVendaId: number;
  loja: string;
  canal: string;
  // já formatada em pt-BR pelo server component (page.tsx) — evita passar Date cru pela
  // fronteira server/client, sem padrão equivalente já testado no resto do projeto.
  dataFormatada: string;
  valorBruto: number;
  valorDevolvido: number;
  itens: number;
  devolucao: "nenhuma" | "parcial" | "total";
};

type NotaInfo = { numero: string | null; chaveAcesso: string | null; numeroSerie: number | null; tipo: string | null };
type NotaItem = {
  produto: string;
  cod: string;
  tamanho: string | null;
  cor: string | null;
  colecao: string | null;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
};

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pedidoKeyOf(n: { storeId: string; dapicVendaId: number }) {
  return `${n.storeId}::${n.dapicVendaId}`;
}

// Concorrência limitada pra resolver número/chave de várias notas sem disparar tudo de uma vez
// no navegador (cada nota não cacheada ainda dispara 1 chamada ao DAPIC do lado do servidor) —
// mesmo espírito do mapWithConcurrency já usado em dapic.ts, só que client-side.
async function withConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const DEVOLUCAO_LABEL: Record<NotaFiscalRow["devolucao"], string | null> = {
  nenhuma: null,
  parcial: "Com devolução parcial",
  total: "Com devolução total",
};

// Lista de Notas Fiscais da Ficha do Cliente (pedido do Rodrigo em 2026-11-11): 1 linha por nota
// (mesma chave storeId::dapicVendaId já usada em "Onde comprou"), cada uma com dropdown próprio
// que busca os produtos daquela nota especificamente, sob demanda, no 1º expand (cache em memória
// do componente pra não refazer o fetch ao colapsar/expandir de novo). Número/chave de acesso são
// resolvidos à parte, de forma assíncrona por linha — não travam a lista nem o resto da página.
export function NotasFiscaisCliente({
  notas,
  clienteNome,
  showFinancials,
}: {
  notas: NotaFiscalRow[];
  clienteNome: string;
  showFinancials: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [itemsCache, setItemsCache] = useState<Map<string, NotaItem[] | "loading" | "error">>(new Map());
  const [infoCache, setInfoCache] = useState<Map<string, NotaInfo | "loading" | "error">>(new Map());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Evita refazer a resolução de número/chave se o componente remontar com as mesmas notas (ex:
  // troca de filtro de loja/marca que não muda o cliente em si).
  const resolvedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const pendentes = notas.filter((n) => !resolvedRef.current.has(pedidoKeyOf(n)));
    if (pendentes.length === 0) return;

    setInfoCache((prev) => {
      const next = new Map(prev);
      for (const n of pendentes) next.set(pedidoKeyOf(n), "loading");
      return next;
    });

    withConcurrency(pendentes, 4, async (n) => {
      const key = pedidoKeyOf(n);
      resolvedRef.current.add(key);
      try {
        const res = await fetch(
          `/api/clientes-ficha/nota-info?cliente=${encodeURIComponent(clienteNome)}&storeId=${encodeURIComponent(n.storeId)}&dapicVendaId=${n.dapicVendaId}`
        );
        if (!res.ok) throw new Error("falhou");
        const info = (await res.json()) as NotaInfo;
        setInfoCache((prev) => new Map(prev).set(key, info));
      } catch {
        setInfoCache((prev) => new Map(prev).set(key, "error"));
      }
    });
    // clienteNome não muda sem remontar a página inteira (troca via novo submit do form de
    // busca) — não precisa entrar nas deps, só notas (identidade da lista).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notas]);

  async function toggle(n: NotaFiscalRow) {
    const key = pedidoKeyOf(n);
    const next = new Set(expanded);
    if (next.has(key)) {
      next.delete(key);
      setExpanded(next);
      return;
    }
    next.add(key);
    setExpanded(next);

    if (itemsCache.has(key)) return; // já em cache (ou já carregando) — não refaz o fetch.
    setItemsCache((prev) => new Map(prev).set(key, "loading"));
    try {
      const res = await fetch(
        `/api/clientes-ficha/nota-itens?cliente=${encodeURIComponent(clienteNome)}&storeId=${encodeURIComponent(n.storeId)}&dapicVendaId=${n.dapicVendaId}`
      );
      if (!res.ok) throw new Error("falhou");
      const json = (await res.json()) as { itens: NotaItem[] };
      setItemsCache((prev) => new Map(prev).set(key, json.itens));
    } catch {
      setItemsCache((prev) => new Map(prev).set(key, "error"));
    }
  }

  async function copiarChave(chave: string, key: string) {
    try {
      await navigator.clipboard.writeText(chave);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
    } catch {
      // clipboard pode não estar disponível (ex: http sem permissão) — falha silenciosa, o valor
      // já está visível na tela pra copiar manualmente.
    }
  }

  if (notas.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Nenhuma nota fiscal encontrada pra esse cliente.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {notas.map((n) => {
        const key = pedidoKeyOf(n);
        const isOpen = expanded.has(key);
        const info = infoCache.get(key);
        const items = itemsCache.get(key);
        const devolucaoLabel = DEVOLUCAO_LABEL[n.devolucao];

        return (
          <div key={key} className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <button
              type="button"
              onClick={() => toggle(n)}
              className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-left"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-block w-3 text-[var(--text-muted)] transition-transform"
                  style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                >
                  ▸
                </span>
                <span className="text-sm font-medium text-[var(--text-primary)]">{n.dataFormatada}</span>
                <span className="text-xs text-[var(--text-secondary)]">{n.loja}</span>
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
                  {n.canal}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {n.itens} {n.itens === 1 ? "item" : "itens"}
                </span>
                {devolucaoLabel && (
                  <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    {devolucaoLabel}
                  </span>
                )}
              </div>
              {showFinancials && (
                <span className="text-sm font-medium tabular-nums text-[var(--text-primary)]">{formatBRL(n.valorBruto)}</span>
              )}
            </button>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--gridline)] px-4 py-2 text-xs text-[var(--text-secondary)]">
              <span>
                Número:{" "}
                {info === undefined || info === "loading" ? (
                  <span className="text-[var(--text-muted)]">carregando…</span>
                ) : info === "error" ? (
                  <span className="text-[var(--text-muted)]">erro ao buscar</span>
                ) : (
                  <span className="font-medium text-[var(--text-primary)]">{info.numero ?? "não disponível"}</span>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                Chave de acesso:{" "}
                {info === undefined || info === "loading" ? (
                  <span className="text-[var(--text-muted)]">carregando…</span>
                ) : info === "error" ? (
                  <span className="text-[var(--text-muted)]">erro ao buscar</span>
                ) : info.chaveAcesso ? (
                  <>
                    <span className="font-mono tabular-nums text-[var(--text-primary)]">{info.chaveAcesso}</span>
                    <button
                      type="button"
                      onClick={() => copiarChave(info.chaveAcesso as string, key)}
                      className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
                    >
                      {copiedKey === key ? "Copiado!" : "Copiar"}
                    </button>
                  </>
                ) : (
                  <span className="text-[var(--text-muted)]">
                    Chave não disponível {info.tipo === "NFCE" ? "(cupom fiscal)" : ""}
                  </span>
                )}
              </span>
            </div>

            {isOpen && (
              <div className="border-t border-[var(--gridline)] px-4 py-3">
                {items === undefined || items === "loading" ? (
                  <p className="text-xs text-[var(--text-muted)]">Carregando produtos…</p>
                ) : items === "error" ? (
                  <p className="text-xs text-[var(--text-muted)]">Não consegui carregar os produtos dessa nota. Tenta de novo.</p>
                ) : items.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">Essa nota não tem itens (dado incompleto na origem).</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] text-xs">
                      <thead>
                        <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                          <th className="py-1.5 pr-3 font-medium">Produto</th>
                          <th className="py-1.5 pr-3 font-medium">Referência</th>
                          <th className="py-1.5 pr-3 font-medium">Tamanho</th>
                          <th className="py-1.5 pr-3 font-medium">Qtd.</th>
                          {showFinancials && <th className="py-1.5 pr-3 font-medium">Valor unit.</th>}
                          {showFinancials && <th className="py-1.5 pr-3 font-medium">Total</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it, i) => (
                          <tr key={i} className="border-b border-[var(--gridline)] last:border-0">
                            <td className="py-1.5 pr-3 text-[var(--text-primary)]">{it.produto}</td>
                            <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{it.cod || "—"}</td>
                            <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{it.tamanho && it.tamanho.trim() ? it.tamanho : "—"}</td>
                            <td className="py-1.5 pr-3 tabular-nums text-[var(--text-secondary)]">{it.quantidade}</td>
                            {showFinancials && <td className="py-1.5 pr-3 tabular-nums text-[var(--text-secondary)]">{formatBRL(it.valorUnitario)}</td>}
                            {showFinancials && <td className="py-1.5 pr-3 tabular-nums text-[var(--text-primary)]">{formatBRL(it.valorTotal)}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
