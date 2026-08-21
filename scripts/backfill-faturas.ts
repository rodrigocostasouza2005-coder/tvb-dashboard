// Backfill histórico completo de faturas (atacado B2B) para o cd-atacado.
// Uso: npx tsx scripts/backfill-faturas.ts
import { PrismaClient, type Prisma } from "@prisma/client";
import { createDapicClients, parseDapicDateTime, stripReferenciaPrefix } from "../src/lib/connectors/dapic";
import { fetchPriceCatalogCached, inferTabelaPreco } from "../src/lib/connectors/tabela-preco";

const directUrl = process.env.DATABASE_URL?.replace("-pooler.", ".");
const prisma = new PrismaClient(directUrl ? { datasourceUrl: directUrl } : undefined);

const DATA_INICIAL = "2025-09-01";
const DATA_FINAL = new Date().toISOString().slice(0, 10);

async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      lastError = err;
      const wait = Math.min(2000 * 2 ** i, 30000);
      console.log(`  retry in ${wait / 1000}s...`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastError;
}

async function main() {
  const clients = createDapicClients();
  const cdAtacado = clients.find((c) => c.label === "cd-atacado");
  if (!cdAtacado) { console.error("cd-atacado client not found"); process.exit(1); }

  // Get storeId for cd-atacado
  const armazenadores = await cdAtacado.fetchArmazenadores();
  let storeId: string | null = null;
  for (const a of armazenadores) {
    const store = await prisma.store.findFirst({ where: { OR: [{ code: a.Descricao }, { dapicArmazenadorId: a.Id }] } });
    if (store?.sellsProducts) { storeId = store.id; break; }
  }
  if (!storeId) { console.error("No sellsProducts store found for cd-atacado"); process.exit(1); }
  console.log(`Store: ${storeId}`);

  const priceCatalog = await fetchPriceCatalogCached(prisma, cdAtacado);

  console.log(`Fetching /faturas from ${DATA_INICIAL} to ${DATA_FINAL}...`);
  const faturas = await withRetry(() => cdAtacado.fetchFaturas(DATA_INICIAL, DATA_FINAL));
  const fechadas = faturas.filter((f) => f.Status === "Fechado" && f.DataFechamento);
  console.log(`${faturas.length} faturas found, ${fechadas.length} fechadas`);

  const saleData: Prisma.SaleCreateManyInput[] = [];
  let processed = 0;

  for (const fatura of fechadas) {
    const saleDate = parseDapicDateTime(fatura.DataFechamento!);
    const produtos = await withRetry(() => cdAtacado.fetchFaturaProdutos(fatura.Id));
    processed++;
    if (processed % 100 === 0) console.log(`  ${processed}/${fechadas.length} faturas processed...`);

    for (const item of produtos) {
      if (item.Tipo !== "Venda") continue;
      saleData.push({
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
        clienteNome: fatura.Cliente ?? null,
        cidade: fatura.Cidade ?? null,
        estado: fatura.Estado ?? null,
        quantidade: item.Quantidade,
        valorTotalLiquido: item.Valores.ValorTotal,
        tabelaPreco: inferTabelaPreco(String(item.IdGradeProduto), item.Valores.ValorUnitario, priceCatalog),
        saleDate,
      });
    }
  }

  console.log(`\nInserting ${saleData.length} sale items...`);
  const BATCH = 2000;
  let inserted = 0;
  for (let i = 0; i < saleData.length; i += BATCH) {
    const r = await withRetry(() =>
      prisma.sale.createMany({ data: saleData.slice(i, i + BATCH), skipDuplicates: true })
    );
    inserted += r.count;
  }

  console.log(`Done. Inserted ${inserted} new records (of ${saleData.length} items).`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
