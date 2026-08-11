// Backfill do histórico de ordens de produção via /ordensproducao/produtos (token da Matriz,
// endpoint descoberto em 2026-08-10 — nunca tinha sido testado com dado real até então).
// Idempotente (upsert em (idOrdemProducao, cod) via SQL bruto, mesmo padrão de
// upsert-stock.ts) — pode rodar de novo sem duplicar. Uso: npx tsx scripts/backfill-ordens-producao.ts
import { PrismaClient } from "@prisma/client";
import { createDapicClients, parseDapicDateTime } from "../src/lib/connectors/dapic";
import { sendTelegramMessage } from "../src/lib/telegram";
import { upsertProductionOrders, type ProductionOrderRow } from "../src/lib/connectors/upsert-production-order";

const directUrl = process.env.DATABASE_URL?.replace("-pooler.", ".");
const prisma = new PrismaClient(directUrl ? { datasourceUrl: directUrl } : undefined);

// Testado em 2026-08-10 com range até 2018: a API não tem nenhuma ordem de produção antes de
// 2025-08-22, então 2018 já cobre "todo o histórico" com folga.
const DATA_INICIAL = "2018-01-01";
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
      console.log(`  (falhou, tentando de novo em ${waitMs / 1000}s...)`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

async function main() {
  const clients = createDapicClients();
  const matriz = clients.find((c) => c.label === "matriz");
  if (!matriz) {
    console.log("Token da matriz não configurado em DAPIC_CREDENTIALS.");
    process.exit(1);
  }

  console.log(`Buscando /ordensproducao/produtos de ${DATA_INICIAL} a ${DATA_FINAL}...`);
  const linhas = await withRetry(() => matriz.fetchOrdensProducaoProdutos(DATA_INICIAL, DATA_FINAL));
  console.log(`${linhas.length} linhas recebidas, gravando...`);

  const rows: ProductionOrderRow[] = linhas
    .filter((l) => l.IdGradeProduto != null)
    .map((l) => ({
      idOrdemProducao: l.IdOrdemProducao,
      cod: String(l.IdGradeProduto),
      ordemProducao: l.OrdemProducao,
      referencia: l.Referencia,
      produto: l.Produto,
      cor: l.Cor ?? null,
      tamanho: l.Tamanho ?? null,
      grupo: l.Grupo ?? "(sem grupo)",
      marca: l.Marca ?? null,
      colecao: l.Colecao ?? null,
      quantidade: l.Quantidade,
      quantidadeOriginal: l.QuantidadeOriginal,
      status: l.Status,
      dataFinalizacaoProducao: l.DataFinalizacaoProducao ? parseDapicDateTime(l.DataFinalizacaoProducao) : null,
      dataEntradaCelula: l.DataEntradaCelula ? parseDapicDateTime(l.DataEntradaCelula) : null,
    }));

  const gravadas = await withRetry(() => upsertProductionOrders(prisma, rows));
  console.log(`${rows.length} linhas -> ${gravadas} gravadas (deduplicadas por idOrdemProducao+cod).`);

  await prisma.syncLog.create({
    data: {
      source: "PRODUCTION",
      status: "SUCCESS",
      recordsSynced: gravadas,
      message: `Backfill histórico completo (${DATA_INICIAL} a ${DATA_FINAL})`,
      finishedAt: new Date(),
    },
  });

  console.log(`\nTotal: ${gravadas} linhas de ordem de produção gravadas.`);
  await sendTelegramMessage(
    `✅ Backfill de ordens de produção concluído\nPeríodo: ${DATA_INICIAL} a ${DATA_FINAL}\nLinhas: ${gravadas}`
  );
}

main()
  .catch(async (e) => {
    console.error(e);
    await sendTelegramMessage(`⚠️ Backfill de ordens de produção falhou: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
