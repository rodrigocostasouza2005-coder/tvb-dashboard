// Preenche Sale.tabelaPreco pra vendas já gravadas, inferindo pelo preço pago (ver
// src/lib/connectors/tabela-preco.ts — nenhuma venda vem com esse campo direto da API).
// Idempotente: só atualiza linhas onde ainda está null; pode rodar de novo sem risco.
// Uso: npx tsx scripts/backfill-tabela-preco.ts
import { PrismaClient, Prisma } from "@prisma/client";
import { createDapicClients } from "../src/lib/connectors/dapic";
import { sellsProducts } from "../src/lib/connectors/armazenadores";
import { fetchPriceCatalog, inferTabelaPreco } from "../src/lib/connectors/tabela-preco";

const directUrl = process.env.DATABASE_URL?.replace("-pooler.", ".");
const prisma = new PrismaClient(directUrl ? { datasourceUrl: directUrl } : undefined);

async function bulkUpdate(updates: { id: string; tabelaPreco: string }[], batchSize = 1000) {
  let total = 0;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const values = batch.map((u) => Prisma.sql`(${u.id}, ${u.tabelaPreco})`);
    await prisma.$executeRaw`
      UPDATE "Sale" AS s SET "tabelaPreco" = v.tabela
      FROM (VALUES ${Prisma.join(values)}) AS v(id, tabela)
      WHERE s.id = v.id
    `;
    total += batch.length;
    console.log(`  ${total}/${updates.length}`);
  }
  return total;
}

// Mesma resolução de "loja principal de venda" de um client usada em sync-runner.ts
// (syncArmazenadores/primaryStoreId) — pega o primeiro armazenador "que vende" que esse token
// enxerga e acha a Store já gravada por dapicArmazenadorId.
async function resolvePrimaryStoreId(client: ReturnType<typeof createDapicClients>[number]) {
  const armazenadores = await client.fetchArmazenadores();
  for (const a of armazenadores) {
    if (!sellsProducts(a.Descricao)) continue;
    const store = await prisma.store.findFirst({ where: { dapicArmazenadorId: a.Id } });
    if (store) return store;
  }
  return null;
}

async function main() {
  const clients = createDapicClients().filter((c) => c.label !== "matriz");
  let totalAtualizado = 0;
  let totalSemMatch = 0;

  for (const client of clients) {
    console.log(`\n--- ${client.label} ---`);
    const store = await resolvePrimaryStoreId(client);
    if (!store) {
      console.log("Sem loja de venda resolvida pra esse token, pulando.");
      continue;
    }

    const sales = await prisma.sale.findMany({
      where: { storeId: store.id, tabelaPreco: null },
      select: { id: true, cod: true, quantidade: true, valorTotalLiquido: true },
    });
    console.log(`${store.name}: ${sales.length} vendas sem tabela.`);
    if (sales.length === 0) continue;

    const catalog = await fetchPriceCatalog(client);
    console.log(`Catálogo: ${catalog.size} SKUs com preço.`);

    const updates: { id: string; tabelaPreco: string }[] = [];
    let semMatch = 0;
    for (const sale of sales) {
      const tabela = inferTabelaPreco(sale.cod, sale.valorTotalLiquido, sale.quantidade, catalog);
      if (tabela) updates.push({ id: sale.id, tabelaPreco: tabela });
      else semMatch++;
    }

    console.log(`${updates.length} vão ganhar tabela, ${semMatch} ficam sem (preço não bate com nenhuma tabela atual).`);
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
      message: `Backfill de tabelaPreco (inferido por preço): ${totalAtualizado} atualizadas, ${totalSemMatch} sem match`,
      finishedAt: new Date(),
    },
  });
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
