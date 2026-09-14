// Backfill único: preenche o campo colecao das devoluções (Return) já existentes no banco,
// buscando de novo o histórico via /vendaspdv (a API já manda Colecao pra linha de devolução,
// só não estava sendo salvo — ver comentário em sync-runner.ts). Só atualiza linhas com
// colecao ainda null, então é seguro rodar de novo (idempotente).
// Uso: npx tsx scripts/backfill-return-colecao.ts

import { PrismaClient } from "@prisma/client";
import { createDapicClients, type DapicClient } from "../src/lib/connectors/dapic";

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
      const waitMs = Math.min(2000 * 2 ** i, 30000);
      console.log(`  (falhou, tentando de novo em ${waitMs / 1000}s...)`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function primaryStoreIdFor(client: DapicClient): Promise<string | null> {
  const armazenadores = await client.fetchArmazenadores();
  for (const a of armazenadores) {
    const store = await prisma.store.findFirst({ where: { OR: [{ code: a.Descricao }, { dapicArmazenadorId: a.Id }] } });
    if (store?.sellsProducts) return store.id;
  }
  return null;
}

async function backfillLoja(client: DapicClient) {
  const storeId = await primaryStoreIdFor(client);
  if (!storeId) {
    console.log(`[${client.label}] nenhuma loja "sellsProducts" encontrada — pulando.`);
    return 0;
  }

  console.log(`[${client.label}] buscando /vendaspdv de ${DATA_INICIAL} a ${DATA_FINAL}...`);
  const vendasPdv = await withRetry(() => client.fetchVendasPdv(DATA_INICIAL, DATA_FINAL));

  const updates: { dapicVendaId: number; itemIndex: number; colecao: string }[] = [];
  for (const venda of vendasPdv) {
    for (const item of venda.Produtos) {
      if (item.Tipo === "Devolução" && item.Colecao) {
        updates.push({ dapicVendaId: venda.Id, itemIndex: item.Id, colecao: item.Colecao });
      }
    }
  }
  console.log(`[${client.label}] ${updates.length} linhas de devolução com coleção na API, atualizando...`);

  let updated = 0;
  await mapWithConcurrency(updates, 20, async (u) => {
    const r = await withRetry(() =>
      prisma.return.updateMany({
        where: { storeId, dapicVendaId: u.dapicVendaId, itemIndex: u.itemIndex, colecao: null },
        data: { colecao: u.colecao },
      })
    );
    updated += r.count;
  });
  console.log(`[${client.label}] ${updated} devoluções atualizadas com coleção.`);
  return updated;
}

async function main() {
  const clients = createDapicClients();
  if (!clients.length) {
    console.log("Nenhuma credencial DAPIC configurada.");
    process.exit(1);
  }

  let total = 0;
  for (const client of clients) {
    total += await backfillLoja(client);
  }

  console.log(`\nTotal: ${total} devoluções atualizadas com coleção.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
