// Preenche/corrige Sale.tabelaPreco pra vendas já gravadas, inferindo pelo preço pago (ver
// src/lib/connectors/tabela-preco.ts — nenhuma venda vem com esse campo direto da API).
//
// IMPORTANTE: usa ValorUnitario (preço de tabela cru), não valorTotalLiquido/quantidade (que já
// vem líquido de desconto avulso + frete somado, e nunca foi guardado separado no banco). Como
// esse campo não existe salvo no Sale, esse script REFAZ a busca na API (vendaspdv pras 3 lojas
// físicas, /faturas pro Site+Atacado) em vez de ler do banco, e casa de volta pelo id da venda
// (dapicVendaId+itemIndex). Sobrescreve qualquer tabelaPreco que já exista (a primeira versão
// desse backfill usava o campo errado e pode ter gravado tabela errada em ~30k linhas).
//
// Uso: npx tsx scripts/backfill-tabela-preco.ts
import { PrismaClient, Prisma } from "@prisma/client";
import { createDapicClients, type DapicClient } from "../src/lib/connectors/dapic";
import { sellsProducts } from "../src/lib/connectors/armazenadores";
import { fetchPriceCatalog, inferTabelaPreco, type PriceCatalog } from "../src/lib/connectors/tabela-preco";

const directUrl = process.env.DATABASE_URL?.replace("-pooler.", ".");
const prisma = new PrismaClient(directUrl ? { datasourceUrl: directUrl } : undefined);

const DATA_INICIAL = "2018-01-01";
const DATA_FINAL = new Date().toISOString().slice(0, 10);

async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const waitMs = Math.min(3000 * 2 ** i, 60000);
      console.log(`  (falhou: ${err instanceof Error ? err.message : err} — tentando de novo em ${waitMs / 1000}s...)`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

async function resolvePrimaryStoreId(client: DapicClient) {
  const armazenadores = await client.fetchArmazenadores();
  for (const a of armazenadores) {
    if (!sellsProducts(a.Descricao)) continue;
    const store = await prisma.store.findFirst({ where: { dapicArmazenadorId: a.Id } });
    if (store) return store;
  }
  return null;
}

async function bulkUpdate(updates: { id: string; tabelaPreco: string }[], batchSize = 1000) {
  let total = 0;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const values = batch.map((u) => Prisma.sql`(${u.id}, ${u.tabelaPreco})`);
    await withRetry(
      () => prisma.$executeRaw`
        UPDATE "Sale" AS s SET "tabelaPreco" = v.tabela
        FROM (VALUES ${Prisma.join(values)}) AS v(id, tabela)
        WHERE s.id = v.id
      `
    );
    total += batch.length;
    console.log(`  ${total}/${updates.length}`);
  }
  return total;
}

async function loadSaleIdMap(storeId: string) {
  const sales = await prisma.sale.findMany({
    where: { storeId },
    select: { id: true, dapicVendaId: true, itemIndex: true },
  });
  return new Map(sales.map((s) => [`${s.dapicVendaId}::${s.itemIndex}`, s.id]));
}

async function backfillViaVendasPdv(client: DapicClient, storeId: string, catalog: PriceCatalog) {
  const [vendas, saleIdByKey] = await Promise.all([
    withRetry(() => client.fetchVendasPdv(DATA_INICIAL, DATA_FINAL)),
    loadSaleIdMap(storeId),
  ]);
  const updates: { id: string; tabelaPreco: string }[] = [];
  let semMatch = 0;

  for (const venda of vendas) {
    if (venda.Status !== "Fechada") continue;
    for (const [itemIndex, item] of venda.Produtos.entries()) {
      if (item.Tipo !== "Venda") continue;
      const cod = item.IdGradeProduto != null ? String(item.IdGradeProduto) : venda.Codigo;
      const tabela = inferTabelaPreco(cod, item.ValorUnitario, catalog);
      if (!tabela) {
        semMatch++;
        continue;
      }
      const saleId = saleIdByKey.get(`${venda.Id}::${itemIndex}`);
      if (saleId) updates.push({ id: saleId, tabelaPreco: tabela });
    }
  }
  return { updates, semMatch };
}

async function backfillViaFaturas(client: DapicClient, storeId: string, catalog: PriceCatalog) {
  const [faturas, saleIdByKey] = await Promise.all([
    withRetry(() => client.fetchFaturas(DATA_INICIAL, DATA_FINAL)),
    loadSaleIdMap(storeId),
  ]);
  const fechadas = faturas.filter((f) => f.Status === "Fechado");
  console.log(`  ${fechadas.length} faturas fechadas — 1 chamada por fatura, vai demorar.`);

  const updates: { id: string; tabelaPreco: string }[] = [];
  let semMatch = 0;
  let processadas = 0;

  for (const fatura of fechadas) {
    const produtos = await withRetry(() => client.fetchFaturaProdutos(fatura.Id));
    for (const [itemIndex, item] of produtos.entries()) {
      if (item.Tipo !== "Venda") continue;
      const cod = String(item.IdGradeProduto);
      const tabela = inferTabelaPreco(cod, item.Valores.ValorUnitario, catalog);
      if (!tabela) {
        semMatch++;
        continue;
      }
      const saleId = saleIdByKey.get(`${fatura.Id}::${itemIndex}`);
      if (saleId) updates.push({ id: saleId, tabelaPreco: tabela });
    }
    processadas++;
    if (processadas % 200 === 0) console.log(`  ${processadas}/${fechadas.length} faturas processadas...`);
    if (updates.length >= 1000) {
      await bulkUpdate(updates.splice(0, updates.length));
    }
  }
  return { updates, semMatch };
}

async function main() {
  // cd-atacado por último de propósito: usa /faturas (1 chamada por fatura, ~8800 faturas,
  // demorado) — as outras 3 lojas via /vendaspdv são rápidas (1 chamada paginada só).
  const clients = createDapicClients()
    .filter((c) => c.label !== "matriz")
    .sort((a, b) => (a.label === "cd-atacado" ? 1 : b.label === "cd-atacado" ? -1 : 0));
  let totalAtualizado = 0;
  let totalSemMatch = 0;

  for (const client of clients) {
    console.log(`\n--- ${client.label} ---`);
    const store = await resolvePrimaryStoreId(client);
    if (!store) {
      console.log("Sem loja de venda resolvida pra esse token, pulando.");
      continue;
    }

    const catalog = await fetchPriceCatalog(client);
    console.log(`${store.name}: catálogo com ${catalog.size} SKUs.`);

    const { updates, semMatch } =
      client.label === "cd-atacado"
        ? await backfillViaFaturas(client, store.id, catalog)
        : await backfillViaVendasPdv(client, store.id, catalog);

    console.log(`${updates.length} vendas vão atualizar, ${semMatch} sem match bom (preço não bate com nenhuma tabela atual).`);
    if (updates.length) await bulkUpdate(updates);
    totalAtualizado += updates.length;
    totalSemMatch += semMatch;
  }

  console.log(`\nTotal: ${totalAtualizado} vendas atualizadas, ${totalSemMatch} sem match bom.`);
  await prisma.syncLog.create({
    data: {
      source: "SALES",
      status: "SUCCESS",
      recordsSynced: totalAtualizado,
      message: `Backfill de tabelaPreco v2 (via ValorUnitario, não mais valorLiquido/quantidade): ${totalAtualizado} atualizadas, ${totalSemMatch} sem match`,
      finishedAt: new Date(),
    },
  });
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
