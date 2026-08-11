// Sincronização real com a API do DAPIC — agora com um token por loja (CD/Atacado, Leblon,
// Rio Sul, Barra), confirmado em 2026-08-07. Cada token só enxerga sua(s) própria(s) loja(s).
// Uso: npx tsx scripts/sync-dapic.ts [diasDeVendas]

import { PrismaClient, type Prisma } from "@prisma/client";
import { createDapicClients, stripReferenciaPrefix, parseDapicDateTime, type DapicClient } from "../src/lib/connectors/dapic";
import { displayGroupFor, sellsProducts } from "../src/lib/connectors/armazenadores";
import { upsertStockSnapshots, type StockSnapshotRow } from "../src/lib/connectors/upsert-stock";
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

  const data: StockSnapshotRow[] = [];
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
      produto: stripReferenciaPrefix(l.Produto),
      grupo: l.Grupo ?? "(sem grupo)",
      cor: l.Cor ?? null,
      tamanho: l.Tamanho ?? null,
      colecao: l.Colecao ?? null,
      quantidadeDisponivel: l.QuantidadeReal ?? l.Quantidade ?? 0,
      estoqueMinimo: null,
      valorCusto: l.ValorCusto ?? null,
    });
  }

  await withRetry(() => upsertStockSnapshots(prisma, data));

  return { linhas: linhas.length, gravadas: data.length, semArmazenador };
}

// Pro token cd-atacado, vendaspdv só tem devolução de verdade — a venda do canal Site+Atacado
// vem de /faturas (confirmado com Rodrigo em 2026-08-10, ver syncFaturas abaixo).
async function syncVendas(client: DapicClient, storeId: string | null) {
  if (!storeId) return { vendas: 0, devolucoes: 0 };
  const contaVendaDoPdv = client.label !== "cd-atacado";

  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - diasDeVendas);

  const vendasPdv = await client.fetchVendasPdv(toDateStr(inicio), toDateStr(hoje));

  const saleData: Prisma.SaleCreateManyInput[] = [];
  const returnData: Prisma.ReturnCreateManyInput[] = [];

  for (const venda of vendasPdv) {
    if (venda.Status !== "Fechada" || !venda.DataFechamento) continue;
    const saleDate = parseDapicDateTime(venda.DataFechamento);

    venda.Produtos.forEach((item, itemIndex) => {
      const cod = item.IdGradeProduto != null ? String(item.IdGradeProduto) : venda.Codigo;
      if (item.Tipo === "Venda" && contaVendaDoPdv) {
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

// Venda de verdade do canal Site+Atacado (só cd-atacado tem acesso a /faturas).
async function syncFaturas(client: DapicClient, storeId: string | null) {
  if (!storeId || client.label !== "cd-atacado") return { vendas: 0 };
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - diasDeVendas);
  const faturas = await client.fetchFaturas(toDateStr(inicio), toDateStr(hoje));

  const saleData: Prisma.SaleCreateManyInput[] = [];
  for (const fatura of faturas) {
    if (fatura.Status !== "Fechado" || !fatura.DataFechamento) continue;
    const saleDate = parseDapicDateTime(fatura.DataFechamento);
    const produtos = await withRetry(() => client.fetchFaturaProdutos(fatura.Id));

    produtos.forEach((item, itemIndex) => {
      if (item.Tipo !== "Venda") return;
      saleData.push({
        storeId,
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
  }

  if (saleData.length)
    await withRetry(() => prisma.sale.createMany({ data: saleData, skipDuplicates: true }));
  return { vendas: saleData.length };
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
    const faturas = await syncFaturas(client, primaryStoreId);
    console.log(`Vendas (${diasDeVendas}d): ${vendas.vendas + faturas.vendas} (pdv ${vendas.vendas} + faturas ${faturas.vendas}) | Devoluções: ${vendas.devolucoes}`);
    totalVendas += vendas.vendas + faturas.vendas;
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
