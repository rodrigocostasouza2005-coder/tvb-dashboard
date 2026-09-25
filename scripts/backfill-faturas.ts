// Backfill histórico completo de faturas (Site+Atacado) para o cd-atacado.
// Grava incrementalmente (a cada FLUSH_EVERY faturas processadas) em vez de só no final —
// se o processo for interrompido, o que já foi buscado não se perde. Também pula de cara
// faturas cujo dapicVendaId já existe no banco (resume seguro sem rebuscar tudo de novo).
// Uso: npx tsx scripts/backfill-faturas.ts
import { PrismaClient, type Prisma } from "@prisma/client";
import { createDapicClients, parseDapicDateTime, stripReferenciaPrefix, stableItemIndexes } from "../src/lib/connectors/dapic";
import { fetchPriceCatalogCached, inferTabelaPreco } from "../src/lib/connectors/tabela-preco";
import { sendTelegramMessage } from "../src/lib/telegram";

const FLUSH_EVERY = 300;
const CONCURRENCY = 14; // 1 chamada por fatura é o gargalo — paraleliza pra não levar horas

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
  const cdAtacadoOrUndefined = clients.find((c) => c.label === "cd-atacado");
  if (!cdAtacadoOrUndefined) { console.error("cd-atacado client not found"); process.exit(1); return; }
  const cdAtacado = cdAtacadoOrUndefined;

  // Site (CD) e Atacado (ATACADO) — desde 2026-09-23 são 2 lojas separadas, ver sync-runner.ts
  // (resolveStoreId). Esse script rodou originalmente quando tudo ia pra uma loja só; atualizado
  // agora pra escolher a loja certa por item, igual a sync automática.
  const armazenadores = await cdAtacado.fetchArmazenadores();
  let siteStoreId: string | null = null;
  let atacadoStoreId: string | null = null;
  for (const a of armazenadores) {
    const store = await prisma.store.findFirst({ where: { OR: [{ code: a.Descricao }, { dapicArmazenadorId: a.Id }] } });
    if (!store) continue;
    if (a.Descricao === "CD") siteStoreId = store.id;
    if (a.Descricao === "ATACADO") atacadoStoreId = store.id;
  }
  if (!siteStoreId) { console.error("Store CD não encontrada"); process.exit(1); return; }
  console.log(`Store site (CD): ${siteStoreId} | Store atacado: ${atacadoStoreId ?? "(não encontrada)"}`);

  const priceCatalog = await fetchPriceCatalogCached(prisma, cdAtacado);
  function resolveStoreId(tabelaPreco: string | null): string {
    return tabelaPreco === "Tabela atacado" && atacadoStoreId ? atacadoStoreId : siteStoreId!;
  }

  console.log(`Fetching /faturas from ${DATA_INICIAL} to ${DATA_FINAL}...`);
  const faturas = await withRetry(() => cdAtacado.fetchFaturas(DATA_INICIAL, DATA_FINAL));
  const fechadas = faturas.filter((f) => f.Status === "Fechado" && f.DataFechamento);
  console.log(`${faturas.length} faturas found, ${fechadas.length} fechadas`);

  // Reprocessa todas as fechadas — com itemIndex determinístico (não item.Id, instável),
  // skipDuplicates no flush() já cuida de não duplicar o que já está gravado; o que sobra de
  // verdade é só o que faltava (fatura parcialmente gravada, achado real na auditoria de
  // 2026-09-24).
  const pendentes = fechadas;
  console.log(`Reprocessando todas as ${pendentes.length} faturas fechadas pra achar item faltando.`);

  let saleData: Prisma.SaleCreateManyInput[] = [];
  let processed = 0;
  let totalInserted = 0;

  async function flush() {
    if (saleData.length === 0) return;
    // Troca a referência ANTES de qualquer await — senão itens empurrados por outros workers
    // durante a gravação (concorrente) seriam perdidos quando saleData virasse [] no final.
    const batch = saleData;
    saleData = [];
    const BATCH = 2000;
    let inserted = 0;
    for (let i = 0; i < batch.length; i += BATCH) {
      const r = await withRetry(() =>
        prisma.sale.createMany({ data: batch.slice(i, i + BATCH), skipDuplicates: true })
      );
      inserted += r.count;
    }
    totalInserted += inserted;
    console.log(`  [flush] gravou ${batch.length} itens (total inserido até agora: ${totalInserted})`);
  }

  async function processOne(fatura: (typeof pendentes)[number]) {
    const saleDate = parseDapicDateTime(fatura.DataFechamento!);
    const produtos = await withRetry(() => cdAtacado.fetchFaturaProdutos(fatura.Id));
    processed++;

    // Índice determinístico pelo conteúdo do item (não item.Id — instável, ver stableItemIndexes
    // em dapic.ts). Não precisa mais checar "já gravada" aqui: com índice reproduzível, o
    // createMany({skipDuplicates:true}) no flush() já pula sozinho qualquer item que bater com o
    // que já está no banco — o que sobra de verdade é só o que faltava (fatura parcialmente
    // gravada, achado real na auditoria de 2026-09-24).
    const itemIndexes = stableItemIndexes(
      produtos,
      (p) => `${p.IdGradeProduto}::${p.Quantidade}::${p.Valores.ValorTotal.toFixed(2)}::${p.Tipo}`
    );
    produtos.forEach((item, pos) => {
      if (item.Tipo !== "Venda") return;
      const tabelaPreco = inferTabelaPreco(String(item.IdGradeProduto), item.Valores.ValorUnitario, priceCatalog);
      saleData.push({
        storeId: resolveStoreId(tabelaPreco),
        dapicVendaId: fatura.Id,
        itemIndex: itemIndexes[pos],
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
        tabelaPreco,
        saleDate,
      });
    });

    if (processed % FLUSH_EVERY === 0) {
      console.log(`  ${processed}/${pendentes.length} faturas processadas...`);
      await flush();
    }
  }

  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= pendentes.length) return;
      await processOne(pendentes[i]);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await flush();

  console.log(`\nDone. Inserted ${totalInserted} new records (${processed} faturas processadas nesta rodada).`);
  await sendTelegramMessage(
    `✅ Backfill de faturas (Dashboard TVB) concluído!\nFaturas processadas: ${processed}\nRegistros novos: ${totalInserted}`
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await sendTelegramMessage(`⚠️ Backfill de faturas falhou: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}).finally(() => prisma.$disconnect());
