// Backfill do histórico de vendas do canal Site+Atacado via /faturas (nota fiscal) — endpoint
// descoberto em 2026-08-10, confirmado pelo Rodrigo como a fonte de verdade de VENDA desse canal
// (vendaspdv desse token só tem devolução de troca, não a venda real). Ver comentário em
// src/lib/connectors/dapic.ts (fetchFaturas) e src/lib/sync-runner.ts (syncVendas/syncFaturas).
//
// Apaga primeiro o Sale existente da loja "TVB Site e Atacado" (era todo vindo de vendaspdv —
// sobras de troca, não venda de verdade — mantê-lo junto com o dado novo duplicaria/distorceria).
// Não idempotente por padrão nesse sentido (assume que só roda uma vez do zero), mas o upsert em
// si é idempotente (pode re-rodar sem duplicar caso precise continuar de onde parou manualmente).
//
// Uso: npx tsx scripts/backfill-faturas-site.ts
import { PrismaClient, Prisma } from "@prisma/client";
import { createDapicClients, stripReferenciaPrefix, parseDapicDateTime } from "../src/lib/connectors/dapic";
import { sendTelegramMessage } from "../src/lib/telegram";

const directUrl = process.env.DATABASE_URL?.replace("-pooler.", ".");
const prisma = new PrismaClient(directUrl ? { datasourceUrl: directUrl } : undefined);

const DATA_INICIAL = "2020-01-01";
const DATA_FINAL = new Date().toISOString().slice(0, 10);
// Pausa entre chamadas de /faturas/{id}/produtos — não tem endpoint em lote, é 1 chamada por
// fatura (~8800 no histórico). Rate limit documentado: 100 req/min por endpoint+chave.
const PAUSA_MS = 700;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const waitMs = Math.min(3000 * 2 ** i, 60000);
      console.log(`  (falhou: ${err instanceof Error ? err.message : err} — tentando de novo em ${waitMs / 1000}s...)`);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

type Row = {
  storeId: string;
  dapicVendaId: number;
  itemIndex: number;
  cod: string;
  produto: string;
  grupo: string;
  cor: string | null;
  tamanho: string | null;
  marca: string | null;
  colecao: string | null;
  clienteNome: string | null;
  cidade: string | null;
  estado: string | null;
  quantidade: number;
  valorTotalLiquido: number;
  saleDate: Date;
};

async function upsertBatch(rows: Row[]) {
  if (!rows.length) return 0;
  const values = rows.map(
    (r) =>
      Prisma.sql`(gen_random_uuid()::text, ${r.storeId}, ${r.dapicVendaId}, ${r.itemIndex}, ${r.cod}, ${r.produto}, ${r.grupo}, ${r.cor}, ${r.tamanho}, ${r.marca}, ${r.colecao}, ${r.clienteNome}, ${r.cidade}, ${r.estado}, ${r.quantidade}, ${r.valorTotalLiquido}, ${r.saleDate})`
  );
  await withRetry(
    () => prisma.$executeRaw`
      INSERT INTO "Sale"
        ("id","storeId","dapicVendaId","itemIndex","cod","produto","grupo","cor","tamanho","marca","colecao","clienteNome","cidade","estado","quantidade","valorTotalLiquido","saleDate")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("storeId","dapicVendaId","itemIndex") DO UPDATE SET
        "cod" = EXCLUDED."cod",
        "produto" = EXCLUDED."produto",
        "grupo" = EXCLUDED."grupo",
        "cor" = EXCLUDED."cor",
        "tamanho" = EXCLUDED."tamanho",
        "marca" = EXCLUDED."marca",
        "colecao" = EXCLUDED."colecao",
        "clienteNome" = EXCLUDED."clienteNome",
        "cidade" = EXCLUDED."cidade",
        "estado" = EXCLUDED."estado",
        "quantidade" = EXCLUDED."quantidade",
        "valorTotalLiquido" = EXCLUDED."valorTotalLiquido",
        "saleDate" = EXCLUDED."saleDate"
    `
  );
  return rows.length;
}

async function main() {
  const cdStore = await prisma.store.findFirst({ where: { code: "CD" } });
  if (!cdStore) throw new Error("Loja CD não encontrada.");

  const clients = createDapicClients();
  const cdAtacado = clients.find((c) => c.label === "cd-atacado");
  if (!cdAtacado) throw new Error("Token cd-atacado não configurado.");

  const apagadas = await prisma.sale.deleteMany({ where: { storeId: cdStore.id } });
  console.log(`Apagadas ${apagadas.count} linhas antigas de Sale do Site e Atacado (vinham de vendaspdv, trocas).`);

  console.log(`Buscando lista de /faturas de ${DATA_INICIAL} a ${DATA_FINAL}...`);
  const faturas = await withRetry(() => cdAtacado.fetchFaturas(DATA_INICIAL, DATA_FINAL));
  const fechadas = faturas.filter((f) => f.Status === "Fechado" && f.DataFechamento);
  console.log(`${faturas.length} faturas recebidas (${fechadas.length} fechadas). Buscando produtos de cada uma...`);
  console.log(`Estimativa: ~${Math.round((fechadas.length * PAUSA_MS) / 1000 / 60)} minutos.`);

  let processadas = 0;
  let totalGravado = 0;
  let buffer: Row[] = [];
  const inicioExec = Date.now();

  for (const fatura of fechadas) {
    const produtos = await withRetry(() => cdAtacado.fetchFaturaProdutos(fatura.Id));
    const saleDate = parseDapicDateTime(fatura.DataFechamento as string);

    produtos.forEach((item, itemIndex) => {
      if (item.Tipo !== "Venda") return;
      buffer.push({
        storeId: cdStore.id,
        dapicVendaId: fatura.Id,
        itemIndex,
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
        saleDate,
      });
    });

    processadas++;
    if (buffer.length >= 500) {
      totalGravado += await upsertBatch(buffer);
      buffer = [];
    }
    if (processadas % 100 === 0) {
      const decorridoMin = (Date.now() - inicioExec) / 60000;
      const faltamMin = (decorridoMin / processadas) * (fechadas.length - processadas);
      console.log(
        `  ${processadas}/${fechadas.length} faturas | ${totalGravado + buffer.length} vendas até agora | faltam ~${faltamMin.toFixed(0)}min`
      );
    }
    await sleep(PAUSA_MS);
  }
  totalGravado += await upsertBatch(buffer);

  await prisma.syncLog.create({
    data: {
      storeId: cdStore.id,
      source: "SALES",
      status: "SUCCESS",
      recordsSynced: totalGravado,
      message: `Backfill histórico via /faturas (${DATA_INICIAL} a ${DATA_FINAL}), substitui dado antigo de vendaspdv`,
      finishedAt: new Date(),
    },
  });

  console.log(`\nTotal: ${totalGravado} vendas gravadas de ${fechadas.length} faturas.`);
  await sendTelegramMessage(
    `✅ Backfill de faturas (Site e Atacado) concluído\nFaturas processadas: ${fechadas.length}\nVendas gravadas: ${totalGravado}`
  );
}

main()
  .catch(async (e) => {
    console.error(e);
    await sendTelegramMessage(`⚠️ Backfill de faturas falhou: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
