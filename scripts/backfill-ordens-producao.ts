// Backfill do histórico de ordens de produção via /ordensproducao/produtos (token da Matriz,
// endpoint descoberto em 2026-08-10 — nunca tinha sido testado com dado real até então).
// Idempotente (upsert em (idOrdemProducao, cod) via SQL bruto, mesmo padrão de
// upsert-stock.ts) — pode rodar de novo sem duplicar. Uso: npx tsx scripts/backfill-ordens-producao.ts
import { PrismaClient, Prisma } from "@prisma/client";
import { createDapicClients } from "../src/lib/connectors/dapic";
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
      console.log(`  (falhou, tentando de novo em ${waitMs / 1000}s...)`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

type Row = {
  idOrdemProducao: number;
  cod: string;
  ordemProducao: string;
  referencia: string;
  produto: string;
  cor: string | null;
  tamanho: string | null;
  grupo: string;
  marca: string | null;
  colecao: string | null;
  quantidade: number;
  quantidadeOriginal: number;
  status: string;
  dataFinalizacaoProducao: Date | null;
  dataEntradaCelula: Date | null;
};

async function upsertBatch(rows: Row[], batchSize = 1000) {
  let total = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = batch.map(
      (r) =>
        Prisma.sql`(gen_random_uuid()::text, ${r.idOrdemProducao}, ${r.cod}, ${r.ordemProducao}, ${r.referencia}, ${r.produto}, ${r.cor}, ${r.tamanho}, ${r.grupo}, ${r.marca}, ${r.colecao}, ${r.quantidade}, ${r.quantidadeOriginal}, ${r.status}, ${r.dataFinalizacaoProducao}, ${r.dataEntradaCelula})`
    );
    await withRetry(
      () => prisma.$executeRaw`
        INSERT INTO "ProductionOrder"
          ("id","idOrdemProducao","cod","ordemProducao","referencia","produto","cor","tamanho","grupo","marca","colecao","quantidade","quantidadeOriginal","status","dataFinalizacaoProducao","dataEntradaCelula")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("idOrdemProducao","cod") DO UPDATE SET
          "ordemProducao" = EXCLUDED."ordemProducao",
          "referencia" = EXCLUDED."referencia",
          "produto" = EXCLUDED."produto",
          "cor" = EXCLUDED."cor",
          "tamanho" = EXCLUDED."tamanho",
          "grupo" = EXCLUDED."grupo",
          "marca" = EXCLUDED."marca",
          "colecao" = EXCLUDED."colecao",
          "quantidade" = EXCLUDED."quantidade",
          "quantidadeOriginal" = EXCLUDED."quantidadeOriginal",
          "status" = EXCLUDED."status",
          "dataFinalizacaoProducao" = EXCLUDED."dataFinalizacaoProducao",
          "dataEntradaCelula" = EXCLUDED."dataEntradaCelula"
      `
    );
    total += batch.length;
    console.log(`  ${total}/${rows.length}`);
  }
  return total;
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

  const rows: Row[] = linhas
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
      dataFinalizacaoProducao: l.DataFinalizacaoProducao ? new Date(l.DataFinalizacaoProducao) : null,
      dataEntradaCelula: l.DataEntradaCelula ? new Date(l.DataEntradaCelula) : null,
    }));

  // A API às vezes repete a mesma combinação (idOrdemProducao+cod) mais de uma vez na resposta
  // (viu-se isso também em /ordensproducao/{id}/materiais) — sem deduplicar, o upsert em lote
  // quebra ("ON CONFLICT DO UPDATE command cannot affect row a second time"), porque o Postgres
  // não aceita a mesma chave duas vezes no mesmo INSERT. Mantém a última ocorrência.
  const dedupMap = new Map<string, Row>();
  for (const r of rows) dedupMap.set(`${r.idOrdemProducao}::${r.cod}`, r);
  const dedupedRows = [...dedupMap.values()];
  console.log(`${rows.length} linhas -> ${dedupedRows.length} depois de deduplicar.`);

  const gravadas = await upsertBatch(dedupedRows);

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
