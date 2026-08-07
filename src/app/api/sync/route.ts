import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createDapicClients, type DapicClient } from "@/lib/connectors/dapic";
import { sendTelegramMessage } from "@/lib/telegram";
import type { Prisma } from "@prisma/client";

// Chamado pelo Vercel Cron (vercel.json) 2x/dia, às 8h e 17h (horário de Brasília).
// O Vercel adiciona automaticamente o header "Authorization: Bearer <CRON_SECRET>" nas
// chamadas de cron quando essa env var existe — é isso que valida o GET abaixo.
// POST continua disponível pra chamar manualmente (com x-cron-secret), útil pra testar.
// Cada credencial em DAPIC_CREDENTIALS é uma loja (CD/Atacado, Leblon, Rio Sul, Barra...).
export const maxDuration = 300;

const NAO_VENDE = /defeito|lixeira|bonifica|marketing/i;

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

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
  for (const l of linhas) {
    const storeId = storeByDapicId.get(l.IdArmazenador);
    if (!storeId) continue;
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
  if (data.length) await prisma.stockSnapshot.createMany({ data });
  return data.length;
}

async function syncVendas(client: DapicClient, storeId: string | null, dias: number) {
  if (!storeId) return { vendas: 0, devolucoes: 0 };
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - dias);
  const vendasPdv = await client.fetchVendasPdv(toDateStr(inicio), toDateStr(hoje));

  const saleData: Prisma.SaleCreateManyInput[] = [];
  const returnData: Prisma.ReturnCreateManyInput[] = [];

  for (const venda of vendasPdv) {
    if (venda.Status !== "Fechada" || !venda.DataFechamento) continue;
    const saleDate = new Date(venda.DataFechamento);

    for (const item of venda.Produtos) {
      const cod = item.IdGradeProduto != null ? String(item.IdGradeProduto) : venda.Codigo;
      if (item.Tipo === "Venda") {
        saleData.push({
          storeId,
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
    }
  }

  if (saleData.length) await prisma.sale.createMany({ data: saleData });
  if (returnData.length) await prisma.return.createMany({ data: returnData });
  return { vendas: saleData.length, devolucoes: returnData.length };
}

async function runSync() {
  try {
    const clients = createDapicClients();
    let totalEstoque = 0;
    let totalVendas = 0;
    let totalDevolucoes = 0;

    for (const client of clients) {
      const { storeByDapicId, primaryStoreId } = await syncArmazenadores(client);
      totalEstoque += await syncEstoque(client, storeByDapicId);
      const vendas = await syncVendas(client, primaryStoreId, 2);
      totalVendas += vendas.vendas;
      totalDevolucoes += vendas.devolucoes;
    }

    await prisma.syncLog.create({
      data: { source: "STOCK", status: "SUCCESS", recordsSynced: totalEstoque, finishedAt: new Date() },
    });
    await prisma.syncLog.create({
      data: { source: "SALES", status: "SUCCESS", recordsSynced: totalVendas, finishedAt: new Date() },
    });
    await prisma.syncLog.create({
      data: { source: "RETURNS", status: "SUCCESS", recordsSynced: totalDevolucoes, finishedAt: new Date() },
    });

    const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    await sendTelegramMessage(
      `✅ Dashboard TVB atualizado (${agora})\nLojas: ${clients.map((c) => c.label).join(", ")}\nEstoque: ${totalEstoque} linhas\nVendas: ${totalVendas} itens\nDevoluções: ${totalDevolucoes} itens`
    );

    return NextResponse.json({ ok: true, lojas: clients.length, estoque: totalEstoque, vendas: totalVendas, devolucoes: totalDevolucoes });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { source: "STOCK", status: "FAILED", message, finishedAt: new Date() },
    });
    await sendTelegramMessage(`⚠️ Falha ao atualizar o Dashboard TVB: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

// Vercel Cron chama via GET com "Authorization: Bearer <CRON_SECRET>" automático.
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runSync();
}

// Disparo manual (ex: pra testar), com o segredo num header próprio.
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runSync();
}
