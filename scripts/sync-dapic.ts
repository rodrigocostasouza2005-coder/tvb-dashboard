// Sincronização real com a API do DAPIC — agora com um token por loja (CD/Atacado, Leblon,
// Rio Sul, Barra), confirmado em 2026-08-07. Cada token só enxerga sua(s) própria(s) loja(s).
// Uso: npx tsx scripts/sync-dapic.ts [diasDeVendas]

import { PrismaClient, type Prisma } from "@prisma/client";
import { createDapicClients, type DapicClient } from "../src/lib/connectors/dapic";
import { sendTelegramMessage } from "../src/lib/telegram";

const prisma = new PrismaClient();

const diasDeVendas = Number(process.argv[2] ?? 3);

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Armazenadores de "defeito", lixeira, bonificação e marketing/produção não são loja de venda.
const NAO_VENDE = /defeito|lixeira|bonifica|marketing/i;

async function syncArmazenadores(client: DapicClient) {
  const armazenadores = await client.fetchArmazenadores();
  const storeByDapicId = new Map<number, string>();
  let primaryStoreId: string | null = null;

  for (const a of armazenadores) {
    const existing = await prisma.store.findFirst({
      where: { OR: [{ code: a.Descricao }, { dapicArmazenadorId: a.Id }] },
    });
    const sellsProducts = !NAO_VENDE.test(a.Descricao);
    const store = existing
      ? await prisma.store.update({ where: { id: existing.id }, data: { dapicArmazenadorId: a.Id } })
      : await prisma.store.create({
          data: { code: a.Descricao, name: a.Descricao, dapicArmazenadorId: a.Id, sellsProducts },
        });
    storeByDapicId.set(a.Id, store.id);
    if (sellsProducts && !primaryStoreId) primaryStoreId = store.id;
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
    await prisma.stockSnapshot.createMany({ data: data.slice(i, i + BATCH) });
  }

  return { linhas: linhas.length, gravadas: data.length, semArmazenador };
}

async function syncVendas(client: DapicClient, storeId: string | null) {
  if (!storeId) return 0;

  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - diasDeVendas);

  const resumos = await client.fetchPedidosVendas(toDateStr(inicio), toDateStr(hoje));

  const data: Prisma.SaleCreateManyInput[] = [];
  for (const resumo of resumos) {
    const detalhe = await client.fetchPedidoVendaDetalhe(resumo.Id);
    for (const item of detalhe.Produtos) {
      data.push({
        storeId,
        cod: detalhe.Codigo,
        produto: item.Produto,
        grupo: "(a confirmar)",
        cor: item.Cor ?? null,
        tamanho: item.Tamanho ?? null,
        clienteNome: detalhe.Cliente?.Nome ?? null,
        tabelaPreco: detalhe.TabelaPrecos ?? null,
        quantidade: item.Quantidade,
        valorTotalLiquido: item.ValorTotal,
        valorFrete: detalhe.Valores?.ValorFrete ?? null,
        saleDate: new Date(detalhe.DataEmissao),
      });
    }
  }

  if (data.length) await prisma.sale.createMany({ data });
  return data.length;
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

  for (const client of clients) {
    console.log(`\n--- ${client.label} ---`);
    const { storeByDapicId, primaryStoreId } = await syncArmazenadores(client);
    console.log(`Armazenadores: ${storeByDapicId.size}`);

    const estoque = await syncEstoque(client, storeByDapicId);
    console.log(`Estoque: ${estoque.gravadas} gravadas de ${estoque.linhas} linhas (${estoque.semArmazenador} sem armazenador)`);
    totalEstoque += estoque.gravadas;

    const vendas = await syncVendas(client, primaryStoreId);
    console.log(`Vendas (${diasDeVendas}d): ${vendas}`);
    totalVendas += vendas;
  }

  await prisma.syncLog.create({
    data: { source: "STOCK", status: "SUCCESS", recordsSynced: totalEstoque, message: `Sync real (${clients.length} lojas)`, finishedAt: new Date() },
  });
  await prisma.syncLog.create({
    data: { source: "SALES", status: "SUCCESS", recordsSynced: totalVendas, message: `Sync real (${clients.length} lojas)`, finishedAt: new Date() },
  });

  const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  await sendTelegramMessage(
    `✅ Dashboard TVB atualizado (${agora})\nLojas: ${clients.map((c) => c.label).join(", ")}\nEstoque: ${totalEstoque} linhas\nVendas: ${totalVendas} itens`
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
