// Sincronização real com a API do DAPIC — agora com um token por loja (CD/Atacado, Leblon,
// Rio Sul, Barra), confirmado em 2026-08-07. Cada token só enxerga sua(s) própria(s) loja(s).
// Uso: npx tsx scripts/sync-dapic.ts [diasDeVendas]

import { PrismaClient, type Prisma } from "@prisma/client";
import { createDapicClients, type DapicClient } from "../src/lib/connectors/dapic";
import { displayGroupFor, sellsProducts } from "../src/lib/connectors/armazenadores";
import { sendTelegramMessage } from "../src/lib/telegram";

// Conexão direta (sem pgbouncer) — scripts longos derrubam a conexão do pooler no meio.
const directUrl = process.env.DATABASE_URL?.replace("-pooler.", ".");
const prisma = new PrismaClient(directUrl ? { datasourceUrl: directUrl } : undefined);

const diasDeVendas = Number(process.argv[2] ?? 3);

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await prisma.$disconnect();
      const waitMs = Math.min(2000 * 2 ** i, 30000);
      console.log(`  (conexão com o banco falhou, tentando de novo em ${waitMs / 1000}s...)`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

async function syncArmazenadores(client: DapicClient) {
  const armazenadores = await client.fetchArmazenadores();
  const storeByDapicId = new Map<number, string>();
  let primaryStoreId: string | null = null;

  for (const a of armazenadores) {
    const existing = await withRetry(() =>
      prisma.store.findFirst({ where: { OR: [{ code: a.Descricao }, { dapicArmazenadorId: a.Id }] } })
    );
    const sells = sellsProducts(a.Descricao);
    const group = displayGroupFor(a.Descricao);
    const store = existing
      ? await withRetry(() =>
          prisma.store.update({
            where: { id: existing.id },
            data: { dapicArmazenadorId: a.Id, displayGroup: group },
          })
        )
      : await withRetry(() =>
          prisma.store.create({
            data: {
              code: a.Descricao,
              name: a.Descricao === "CD" ? "TVB Site e Atacado" : a.Descricao,
              dapicArmazenadorId: a.Id,
              sellsProducts: sells,
              displayGroup: group,
            },
          })
        );
    storeByDapicId.set(a.Id, store.id);
    if (sells && !primaryStoreId) primaryStoreId = store.id;
  }

  return { storeByDapicId, primaryStoreId };
}

async function syncEstoque(client: DapicClient, storeByDapicId: Map<number, string>) {
  const linhas = await client.fetchEstoqueTodosArmazenadores();

  const data: Prisma.StockSnapshotCreateManyInput[] = [];
  let semArmazenador = 0;

  for (const l of linhas) {
    const storeId = storeByDapicId.get(l.IdArmazenador);
    if (!storeId) {
      semArmazenador++;
      continue;
    }
    data.push({
      storeId,
      cod: String(l.IdGradeProduto),
      produto: l.Produto,
      grupo: l.Grupo ?? "(sem grupo)",
      cor: l.Cor ?? null,
      tamanho: l.Tamanho ?? null,
      colecao: l.Colecao ?? null,
      quantidadeDisponivel: l.QuantidadeReal ?? l.Quantidade ?? 0,
      valorCusto: l.ValorCusto ?? null,
    });
  }

  const BATCH = 2000;
  for (let i = 0; i < data.length; i += BATCH) {
    await withRetry(() => prisma.stockSnapshot.createMany({ data: data.slice(i, i + BATCH) }));
  }

  return { linhas: linhas.length, gravadas: data.length, semArmazenador };
}

async function syncVendas(client: DapicClient, storeId: string | null) {
  if (!storeId) return { vendas: 0, devolucoes: 0 };

  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - diasDeVendas);

  const vendasPdv = await client.fetchVendasPdv(toDateStr(inicio), toDateStr(hoje));

  const saleData: Prisma.SaleCreateManyInput[] = [];
  const returnData: Prisma.ReturnCreateManyInput[] = [];

  for (const venda of vendasPdv) {
    if (venda.Status !== "Fechada" || !venda.DataFechamento) continue;
    const saleDate = new Date(venda.DataFechamento);

    venda.Produtos.forEach((item, itemIndex) => {
      const cod = item.IdGradeProduto != null ? String(item.IdGradeProduto) : venda.Codigo;
      if (item.Tipo === "Venda") {
        saleData.push({
          storeId,
          dapicVendaId: venda.Id,
          itemIndex,
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
          itemIndex,
          cod,
          produto: item.Produto,
          grupo: item.Grupo ?? "(sem grupo)",
          cor: item.Cor ?? null,
          tamanho: item.Tamanho ?? null,
          quantidade: item.Quantidade,
          valorTotal: item.ValorLiquido,
          returnDate: saleDate,
        });
      }
      // "Brinde" fica de fora por enquanto — não é venda nem devolução de verdade.
    });
  }

  // skipDuplicates: idempotente em cima de (storeId, dapicVendaId, itemIndex) — rerodar a sync
  // com uma janela de datas que se sobrepõe à anterior não duplica mais as vendas/devoluções.
  if (saleData.length)
    await withRetry(() => prisma.sale.createMany({ data: saleData, skipDuplicates: true }));
  if (returnData.length)
    await withRetry(() => prisma.return.createMany({ data: returnData, skipDuplicates: true }));
  return { vendas: saleData.length, devolucoes: returnData.length };
}

async function main() {
  const clients = createDapicClients();
  if (!clients.length) {
    console.log("Nenhuma credencial DAPIC configurada (DAPIC_CREDENTIALS ou DAPIC_TOKEN_INTEGRACAO).");
    process.exit(1);
  }
  console.log(`Sincronizando ${clients.length} loja(s): ${clients.map((c) => c.label).join(", ")}`);

  let totalEstoque = 0;
  let totalVendas = 0;
  let totalDevolucoes = 0;

  for (const client of clients) {
    console.log(`\n--- ${client.label} ---`);
    const { storeByDapicId, primaryStoreId } = await syncArmazenadores(client);
    console.log(`Armazenadores: ${storeByDapicId.size}`);

    const estoque = await syncEstoque(client, storeByDapicId);
    console.log(`Estoque: ${estoque.gravadas} gravadas de ${estoque.linhas} linhas (${estoque.semArmazenador} sem armazenador)`);
    totalEstoque += estoque.gravadas;

    const vendas = await syncVendas(client, primaryStoreId);
    console.log(`Vendas (${diasDeVendas}d): ${vendas.vendas} | Devoluções: ${vendas.devolucoes}`);
    totalVendas += vendas.vendas;
    totalDevolucoes += vendas.devolucoes;
  }

  await prisma.syncLog.create({
    data: { source: "STOCK", status: "SUCCESS", recordsSynced: totalEstoque, message: `Sync real (${clients.length} lojas)`, finishedAt: new Date() },
  });
  await prisma.syncLog.create({
    data: { source: "SALES", status: "SUCCESS", recordsSynced: totalVendas, message: `Sync real (${clients.length} lojas)`, finishedAt: new Date() },
  });
  await prisma.syncLog.create({
    data: { source: "RETURNS", status: "SUCCESS", recordsSynced: totalDevolucoes, message: `Sync real (${clients.length} lojas)`, finishedAt: new Date() },
  });

  const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  await sendTelegramMessage(
    `✅ Dashboard TVB atualizado (${agora})\nLojas: ${clients.map((c) => c.label).join(", ")}\nEstoque: ${totalEstoque} linhas\nVendas: ${totalVendas} itens\nDevoluções: ${totalDevolucoes} itens`
  );

  console.log("\nSync concluído.");
}

main()
  .catch(async (e) => {
    console.error(e);
    await sendTelegramMessage(`⚠️ Falha ao atualizar o Dashboard TVB: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
