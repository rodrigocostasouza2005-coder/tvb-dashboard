import type { DapicClient } from "./dapic";

export type PriceCatalog = Map<string, { table: string; valor: number }[]>;

// Nenhuma venda (/vendaspdv nem /faturas) diz direto qual tabela de preço (varejo/atacado/etc)
// valeu — só o endpoint abandonado /pedidosvendas tinha esse campo. Em vez disso, busca o
// catálogo atual de /tabelaprecos (preço por SKU por tabela) e infere pela venda batendo o preço
// pago. Validado em 2026-08-11 contra 500 vendas reais do Leblon: 96% bateram exato (diff <
// R$0,01) com alguma tabela — o resto (preço mudou desde a venda, desconto avulso etc) fica sem
// tabela em vez de arriscar um chute errado.
export async function fetchPriceCatalog(client: DapicClient): Promise<PriceCatalog> {
  const tabelas = await client.fetchTabelasPrecos();
  const catalog: PriceCatalog = new Map();
  for (const t of tabelas) {
    const produtos = await client.fetchTabelaPrecoProdutos(t.Id);
    for (const p of produtos) {
      const cod = String(p.IdGradeProduto);
      const list = catalog.get(cod) ?? [];
      list.push({ table: t.Descricao, valor: p.Valor });
      catalog.set(cod, list);
    }
  }
  return catalog;
}

// Tolerância de R$1 — folga pequena o suficiente pra não confundir tabelas diferentes (a menor
// diferença real vista entre tabelas no catálogo é de vários reais), grande o suficiente pra
// arredondamento de centavos não derrubar um match real.
const TOLERANCIA_REAIS = 1;

export function inferTabelaPreco(
  cod: string,
  valorTotalLiquido: number,
  quantidade: number,
  catalog: PriceCatalog
): string | null {
  const options = catalog.get(cod);
  if (!options?.length || quantidade <= 0) return null;
  const valorUnitario = valorTotalLiquido / quantidade;

  let best = options[0];
  let bestDiff = Math.abs(valorUnitario - best.valor);
  for (const o of options.slice(1)) {
    const diff = Math.abs(valorUnitario - o.valor);
    if (diff < bestDiff) {
      best = o;
      bestDiff = diff;
    }
  }
  return bestDiff < TOLERANCIA_REAIS ? best.table : null;
}
