// Backfill único do histórico completo de brindes (Tipo=Brinde), pras 4 lojas — antes esses itens
// eram descartados no sync (nem gravados). Mesma fonte de cada canal que Sale já usa: /vendaspdv
// pras 3 lojas físicas, /faturas pro Site+Atacado. Idempotente (skipDuplicates em
// storeId+dapicVendaId+itemIndex).
// Uso: npx tsx scripts/backfill-brindes.ts
import { PrismaClient, type Prisma } from "@prisma/client";
import { createDapicClients, parseDapicDateTime, stripReferenciaPrefix, type DapicClient } from "../src/lib/connectors/dapic";
import { sellsProducts } from "../src/lib/connectors/armazenadores";
import { sendTelegramMessage } from "../src/lib/telegram";

const directUrl = process.env.DATABASE_URL?.replace("-pooler.", ".");
const prisma = new PrismaClient(directUrl ? { datasourceUrl: directUrl } : undefined);

const DATA_INICIAL = "2024-01-01";
const DATA_FINAL = new Date().toISOString().slice(0, 10);

async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await prisma.$disconnect();
      const waitMs = Math.min(2000 * 2 ** i, 30000);
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
    if (store) return store.id;
  }
  return null;
}

async function saveGifts(giftData: Prisma.GiftCreateManyInput[], batchSize = 2000) {
  let total = 0;
  for (let i = 0; i < giftData.length; i += batchSize) {
    const r = await withRetry(() =>
      prisma.gift.createMany({ data: giftData.slice(i, i + batchSize), skipDuplicates: true })
    );
    total += r.count;
  }
  return total;
}

async function backfillViaVendasPdv(client: DapicClient, storeId: string) {
  const vendas = await withRetry(() => client.fetchVendasPdv(DATA_INICIAL, DATA_FINAL));
  const giftData: Prisma.GiftCreateManyInput[] = [];

  for (const venda of vendas) {
    if (venda.Status !== "Fechada" || !venda.DataFechamento) continue;
    const giftDate = parseDapicDateTime(venda.DataFechamento);
    venda.Produtos.forEach((item) => {
      if (item.Tipo !== "Brinde") return;
      const cod = item.IdGradeProduto != null ? String(item.IdGradeProduto) : venda.Codigo;
      giftData.push({
        storeId,
        dapicVendaId: venda.Id,
        itemIndex: item.Id,
        cod,
        produto: item.Produto,
        grupo: item.Grupo ?? "(sem grupo)",
        cor: item.Cor ?? null,
        tamanho: item.Tamanho ?? null,
        marca: item.Marca ?? null,
        colecao: item.Colecao ?? null,
        quantidade: item.Quantidade,
        valorTotalLiquido: item.ValorLiquido,
        giftDate,
      });
    });
  }
  return saveGifts(giftData);
}

async function backfillViaFaturas(client: DapicClient, storeId: string) {
  const faturas = await withRetry(() => client.fetchFaturas(DATA_INICIAL, DATA_FINAL));
  const fechadas = faturas.filter((f) => f.Status === "Fechado" && f.DataFechamento);
  console.log(`  ${fechadas.length} faturas fechadas — 1 chamada por fatura, vai demorar.`);

  const giftData: Prisma.GiftCreateManyInput[] = [];
  let processadas = 0;
  let gravadas = 0;

  for (const fatura of fechadas) {
    const produtos = await withRetry(() => client.fetchFaturaProdutos(fatura.Id));
    const giftDate = parseDapicDateTime(fatura.DataFechamento as string);
    produtos.forEach((item) => {
      if (item.Tipo !== "Brinde") return;
      giftData.push({
        storeId,
        dapicVendaId: fatura.Id,
        itemIndex: item.Id,
        cod: String(item.IdGradeProduto),
        produto: stripReferenciaPrefix(item.Produto),
        grupo: item.Grupo ?? "(sem grupo)",
        cor: item.Cor ?? null,
        tamanho: item.Tamanho ?? null,
        marca: item.Marca ?? null,
        colecao: item.Colecao ?? null,
        quantidade: item.Quantidade,
        valorTotalLiquido: item.Valores.ValorTotal,
        giftDate,
      });
    });
    processadas++;
    if (processadas % 500 === 0) console.log(`  ${processadas}/${fechadas.length} faturas processadas...`);
    if (giftData.length >= 2000) gravadas += await saveGifts(giftData.splice(0, giftData.length));
  }
  gravadas += await saveGifts(giftData);
  return gravadas;
}

async function main() {
  const clients = createDapicClients()
    .filter((c) => c.label !== "matriz")
    .sort((a, b) => (a.label === "cd-atacado" ? 1 : b.label === "cd-atacado" ? -1 : 0));

  let total = 0;
  for (const client of clients) {
    console.log(`\n--- ${client.label} ---`);
    const storeId = await resolvePrimaryStoreId(client);
    if (!storeId) {
      console.log("Sem loja de venda resolvida pra esse token, pulando.");
      continue;
    }
    const gravadas =
      client.label === "cd-atacado"
        ? await backfillViaFaturas(client, storeId)
        : await backfillViaVendasPdv(client, storeId);
    console.log(`${gravadas} brindes gravados.`);
    total += gravadas;
  }

  await prisma.syncLog.create({
    data: {
      source: "GIFTS",
      status: "SUCCESS",
      recordsSynced: total,
      message: `Backfill histórico completo de brindes (${DATA_INICIAL} a ${DATA_FINAL})`,
      finishedAt: new Date(),
    },
  });

  console.log(`\nTotal: ${total} brindes gravados.`);
  await sendTelegramMessage(`✅ Backfill de Brinde concluído\nTotal: ${total} itens`);
}

main()
  .catch(async (e) => {
    console.error(e);
    await sendTelegramMessage(`⚠️ Backfill de Brinde falhou: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
