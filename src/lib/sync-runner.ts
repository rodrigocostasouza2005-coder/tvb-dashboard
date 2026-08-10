import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createDapicClients, stripReferenciaPrefix, type DapicClient } from "@/lib/connectors/dapic";
import { displayGroupFor, sellsProducts } from "@/lib/connectors/armazenadores";
import { upsertStockSnapshots, type StockSnapshotRow } from "@/lib/connectors/upsert-stock";
import { sendTelegramMessage } from "@/lib/telegram";
import { getTopParaIncentivar, getTopVendidosPorLoja } from "@/lib/metrics";
import type { Prisma } from "@prisma/client";

// Lógica compartilhada pelas duas rotas de sync (/api/sync e /api/sync-evening) — precisam ser
// arquivos de rota separados (paths diferentes) porque o plano Hobby da Vercel só permite um
// cron job rodando 1x/dia CADA, e dois crons apontando pro mesmo path deixavam o registro deles
// num estado ambíguo (a sync da manhã simplesmente parou de disparar).

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
    const sells = sellsProducts(a.Descricao);
    const group = displayGroupFor(a.Descricao);
    const store = existing
      ? await prisma.store.update({
          where: { id: existing.id },
          data: { dapicArmazenadorId: a.Id, displayGroup: group },
        })
      : await prisma.store.create({
          data: {
            code: a.Descricao,
            name: a.Descricao === "CD" ? "TVB Site e Atacado" : a.Descricao,
            dapicArmazenadorId: a.Id,
            sellsProducts: sells,
            displayGroup: group,
          },
        });
    storeByDapicId.set(a.Id, store.id);
    if (sells && !primaryStoreId) primaryStoreId = store.id;
  }

  return { storeByDapicId, primaryStoreId };
}

async function syncEstoque(client: DapicClient, storeByDapicId: Map<number, string>) {
  const linhas = await client.fetchEstoqueTodosArmazenadores();
  const data: StockSnapshotRow[] = [];
  for (const l of linhas) {
    const storeId = storeByDapicId.get(l.IdArmazenador);
    if (!storeId) continue;
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
  if (data.length) await upsertStockSnapshots(prisma, data);
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
    });
  }

  // skipDuplicates: idempotente em cima de (storeId, dapicVendaId, itemIndex) — o cron roda 2x/dia
  // olhando sempre "últimos N dias", então as janelas se sobrepõem e sem isso duplicava tudo.
  if (saleData.length) await prisma.sale.createMany({ data: saleData, skipDuplicates: true });
  if (returnData.length) await prisma.return.createMany({ data: returnData, skipDuplicates: true });
  return { vendas: saleData.length, devolucoes: returnData.length };
}

function formatProduto(p: string, estoque: number, vendido: number) {
  return `• ${p} (estoque ${estoque}, vendeu ${vendido})`;
}

async function buildResumoMessage(desde: Date) {
  const [incentivar, porLoja] = await Promise.all([
    getTopParaIncentivar(30, 10),
    getTopVendidosPorLoja(desde, 3),
  ]);

  const partes: string[] = [];

  if (incentivar.length) {
    partes.push(
      "\n📦 Top 10 pra incentivar (estoque parado, pouca venda nos últimos 30d):\n" +
        incentivar.map((p) => formatProduto(p.produto, p.estoque, p.vendido)).join("\n")
    );
  }

  if (porLoja.length) {
    partes.push(
      "\n🏆 Mais vendidos por loja desde a última atualização:\n" +
        porLoja
          .map(
            (l) =>
              `${l.storeName}:\n` +
              l.produtos.map((p) => `  • ${p.produto} (${p.quantidade})`).join("\n")
          )
          .join("\n")
    );
  }

  return partes.join("\n");
}

export async function runSync() {
  // Pega o horário do último sync ANTES de rodar esse aqui, pra "vendido desde a última
  // atualização" comparar com o período certo (não com o que acabamos de gravar agora).
  const ultimoSync = await prisma.syncLog.findFirst({
    where: { source: "SALES", status: "SUCCESS" },
    orderBy: { startedAt: "desc" },
  });
  const desde = ultimoSync?.startedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    const clients = createDapicClients();

    // Lojas em paralelo, não em sequência — cada uma leva dezenas de segundos pra buscar o
    // estoque completo na API do DAPIC, e rodando uma por vez as 4 juntas passavam dos 300s
    // (maxDuration) e a função da Vercel dava timeout, quebrando a sync automática.
    const results = await Promise.all(
      clients.map(async (client) => {
        const { storeByDapicId, primaryStoreId } = await syncArmazenadores(client);
        const estoque = await syncEstoque(client, storeByDapicId);
        const vendas = await syncVendas(client, primaryStoreId, 2);
        return { estoque, vendas: vendas.vendas, devolucoes: vendas.devolucoes };
      })
    );

    const totalEstoque = results.reduce((a, r) => a + r.estoque, 0);
    const totalVendas = results.reduce((a, r) => a + r.vendas, 0);
    const totalDevolucoes = results.reduce((a, r) => a + r.devolucoes, 0);

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
    const resumo = await buildResumoMessage(desde).catch(() => "");
    await sendTelegramMessage(
      `✅ Dashboard TVB atualizado (${agora})\nLojas: ${clients.map((c) => c.label).join(", ")}\nEstoque: ${totalEstoque} linhas\nVendas: ${totalVendas} itens\nDevoluções: ${totalDevolucoes} itens\n${resumo}`
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
export async function handleSyncGet(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runSync();
}

// Disparo manual (ex: pra testar), com o segredo num header próprio.
export async function handleSyncPost(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runSync();
}
