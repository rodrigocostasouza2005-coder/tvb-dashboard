import type { PrismaClient } from "@prisma/client";
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

const PRICE_CATALOG_MAX_AGE_HORAS = 20;

// Lê o catálogo do cache (PriceCatalogCache) se ainda estiver "fresco"; senão busca na API e
// atualiza o cache. 20h de folga (não 24h) — cobre um sync 2x/dia (12h de intervalo) sem correr
// risco de nunca invalidar por causa de arredondamento de horário.
export async function fetchPriceCatalogCached(prisma: PrismaClient, client: DapicClient): Promise<PriceCatalog> {
  const cached = await prisma.priceCatalogCache.findUnique({ where: { clientLabel: client.label } });
  const isFresh = cached && Date.now() - cached.updatedAt.getTime() < PRICE_CATALOG_MAX_AGE_HORAS * 60 * 60 * 1000;
  if (isFresh) {
    return new Map(Object.entries(cached.data as Record<string, { table: string; valor: number }[]>));
  }

  const fresh = await fetchPriceCatalog(client);
  await prisma.priceCatalogCache.upsert({
    where: { clientLabel: client.label },
    create: { clientLabel: client.label, data: Object.fromEntries(fresh) },
    update: { data: Object.fromEntries(fresh) },
  });
  return fresh;
}

// Tolerância de R$1 — folga pequena o suficiente pra não confundir tabelas diferentes (a menor
// diferença real vista entre tabelas no catálogo é de vários reais), grande o suficiente pra
// arredondamento de centavos não derrubar um match real.
const TOLERANCIA_REAIS = 1;

// IMPORTANTE: precisa ser o "ValorUnitario" cru da API (preço de tabela, antes de desconto/frete
// avulso do item) — NÃO "ValorLiquido"/"ValorTotal" (que já vem líquido de desconto e com frete
// somado). Achado em 2026-08-11 depois do Rodrigo estranhar a taxa baixa de match: comparar
// contra o valor líquido derrubava o acerto pra ~90% (lojas físicas) ou ~40% (Site+Atacado, que
// tem frete quase sempre). Usando ValorUnitario, sobe pra 99.1% (testado contra 2883 itens reais
// do Leblon).
export function inferTabelaPreco(cod: string, valorUnitario: number, catalog: PriceCatalog): string | null {
  const options = catalog.get(cod);
  if (!options?.length) return null;

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
