// Backfill único do histórico completo de vendas/devoluções via /vendaspdv, para as 4 lojas.
// Diferente do sync do cron (que só olha os últimos dias), este script busca o range inteiro
// disponível na API. Idempotente (skipDuplicates em cima de storeId+dapicVendaId+itemIndex) —
// pode ser rodado de novo sem duplicar nada.
// Uso: npx tsx scripts/backfill-vendas.ts

import { PrismaClient, type Prisma } from "@prisma/client";
import { createDapicClients, parseDapicDateTime, type DapicClient } from "../src/lib/connectors/dapic";
import { fetchPriceCatalogCached, inferTabelaPreco } from "../src/lib/connectors/tabela-preco";
import { sendTelegramMessage } from "../src/lib/telegram";

const directUrl = process.env.DATABASE_URL?.replace("-pooler.", ".");
const prisma = new PrismaClient(directUrl ? { datasourceUrl: directUrl } : undefined);

// Confirmado por sondagem em 2026-08-08: dado real mais antigo é de 2025-09-24 (Leblon).
// 2024-01-01 dá margem de sobra sem custar mais chamadas (a API só devolve o que existe).
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

async function primaryStoreIdFor(client: DapicClient): Promise<string | null> {
  const armazenadores = await client.fetchArmazenadores();
  for (const a of armazenadores) {
    const store = await withRetry(() =>
      prisma.store.findFirst({ where: { OR: [{ code: a.Descricao }, { dapicArmazenadorId: a.Id }] } })
    );
    if (store?.sellsProducts) return store.id;
  }
  return null;
}

async function backfillLoja(client: DapicClient) {
  const storeId = await primaryStoreIdFor(client);
  if (!storeId) {
    console.log(`[${client.label}] nenhuma loja "sellsProducts" encontrada — pulando.`);
    return { vendas: 0, devolucoes: 0 };
  }

  const priceCatalog = await fetchPriceCatalogCached(prisma, client);

  console.log(`[${client.label}] buscando /vendaspdv de ${DATA_INICIAL} a ${DATA_FINAL}...`);
  const vendasPdv = await withRetry(() => client.fetchVendasPdv(DATA_INICIAL, DATA_FINAL));
  console.log(`[${client.label}] ${vendasPdv.length} vendas/pedidos recebidos, gravando...`);

  const saleData: Prisma.SaleCreateManyInput[] = [];
  const returnData: Prisma.ReturnCreateManyInput[] = [];

  for (const venda of vendasPdv) {
    if (venda.Status !== "Fechada" || !venda.DataFechamento) continue;
    const saleDate = parseDapicDateTime(venda.DataFechamento);

    venda.Produtos.forEach((item) => {
      const cod = item.IdGradeProduto != null ? String(item.IdGradeProduto) : venda.Codigo;
      if (item.Tipo === "Venda") {
        saleData.push({
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
          clienteNome: venda.Cliente ?? null,
          vendedor: venda.Vendedor ?? null,
          cidade: venda.Cidade?.Nome ?? null,
          estado: venda.Cidade?.Estado ?? null,
          quantidade: item.Quantidade,
          valorTotalLiquido: item.ValorLiquido,
          saleDate,
        });
      } else if (item.Tipo === "Devolução") {
        returnData.push({
          storeId,
          dapicVendaId: venda.Id,
          itemIndex: item.Id,
          cod,
          produto: item.Produto,
          grupo: item.Grupo ?? "(sem grupo)",
          cor: item.Cor ?? null,
          tamanho: item.Tamanho ?? null,
          marca: item.Marca ?? null,
          tabelaPreco: inferTabelaPreco(cod, item.ValorUnitario, priceCatalog),
          quantidade: item.Quantidade,
          valorTotal: item.ValorLiquido,
          returnDate: saleDate,
        });
      }
    });
  }

  const BATCH = 2000;
  let vendasGravadas = 0;
  for (let i = 0; i < saleData.length; i += BATCH) {
    const r = await withRetry(() =>
      prisma.sale.createMany({ data: saleData.slice(i, i + BATCH), skipDuplicates: true })
    );
    vendasGravadas += r.count;
  }
  let devolucoesGravadas = 0;
  for (let i = 0; i < returnData.length; i += BATCH) {
    const r = await withRetry(() =>
      prisma.return.createMany({ data: returnData.slice(i, i + BATCH), skipDuplicates: true })
    );
    devolucoesGravadas += r.count;
  }

  console.log(
    `[${client.label}] gravado: ${vendasGravadas} vendas (de ${saleData.length} itens), ${devolucoesGravadas} devoluções (de ${returnData.length} itens)`
  );
  return { vendas: vendasGravadas, devolucoes: devolucoesGravadas };
}

async function main() {
  const clients = createDapicClients();
  if (!clients.length) {
    console.log("Nenhuma credencial DAPIC configurada.");
    process.exit(1);
  }

  let totalVendas = 0;
  let totalDevolucoes = 0;
  for (const client of clients) {
    const r = await backfillLoja(client);
    totalVendas += r.vendas;
    totalDevolucoes += r.devolucoes;
  }

  await prisma.syncLog.create({
    data: {
      source: "SALES",
      status: "SUCCESS",
      recordsSynced: totalVendas,
      message: `Backfill histórico completo (${DATA_INICIAL} a ${DATA_FINAL})`,
      finishedAt: new Date(),
    },
  });

  console.log(`\nTotal: ${totalVendas} vendas, ${totalDevolucoes} devoluções gravadas.`);
  await sendTelegramMessage(
    `✅ Backfill de histórico completo (Dashboard TVB)\nPeríodo: ${DATA_INICIAL} a ${DATA_FINAL}\nVendas: ${totalVendas}\nDevoluções: ${totalDevolucoes}`
  );
}

main()
  .catch(async (e) => {
    console.error(e);
    await sendTelegramMessage(`⚠️ Backfill de histórico falhou: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
