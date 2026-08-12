import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createDapicClients, stripReferenciaPrefix, parseDapicDateTime, type DapicClient } from "@/lib/connectors/dapic";
import { displayGroupFor, sellsProducts } from "@/lib/connectors/armazenadores";
import { upsertStockSnapshots, type StockSnapshotRow } from "@/lib/connectors/upsert-stock";
import { upsertProductionOrders, type ProductionOrderRow } from "@/lib/connectors/upsert-production-order";
import { fetchPriceCatalog, inferTabelaPreco, type PriceCatalog } from "@/lib/connectors/tabela-preco";
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

// Pro token cd-atacado, vendaspdv só tem devolução de verdade — a venda do canal Site+Atacado
// vem de /faturas (confirmado com Rodrigo em 2026-08-10). As linhas "Venda" que aparecem aqui
// pra esse token são só o lado de troca (pareada com uma devolução), não a venda real — ignora.
async function syncVendas(client: DapicClient, storeId: string | null, dias: number, priceCatalog: PriceCatalog) {
  if (!storeId) return { vendas: 0, devolucoes: 0, brindes: 0 };
  const contaVendaDoPdv = client.label !== "cd-atacado";
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - dias);
  const vendasPdv = await client.fetchVendasPdv(toDateStr(inicio), toDateStr(hoje));

  const saleData: Prisma.SaleCreateManyInput[] = [];
  const returnData: Prisma.ReturnCreateManyInput[] = [];
  const giftData: Prisma.GiftCreateManyInput[] = [];

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
          tabelaPreco: inferTabelaPreco(cod, item.ValorUnitario, priceCatalog),
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
      } else if (item.Tipo === "Brinde") {
        giftData.push({
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
          quantidade: item.Quantidade,
          valorTotalLiquido: item.ValorLiquido,
          giftDate: saleDate,
        });
      }
    });
  }

  // skipDuplicates: idempotente em cima de (storeId, dapicVendaId, itemIndex) — o cron roda 2x/dia
  // olhando sempre "últimos N dias", então as janelas se sobrepõem e sem isso duplicava tudo.
  if (saleData.length) await prisma.sale.createMany({ data: saleData, skipDuplicates: true });
  if (returnData.length) await prisma.return.createMany({ data: returnData, skipDuplicates: true });
  if (giftData.length) await prisma.gift.createMany({ data: giftData, skipDuplicates: true });
  return { vendas: saleData.length, devolucoes: returnData.length, brindes: giftData.length };
}

// Venda de verdade do canal Site+Atacado (só cd-atacado tem acesso a /faturas). Mesma chave de
// idempotência (storeId, dapicVendaId=Id da fatura, itemIndex) — nunca colide com vendaspdv
// porque esse token não grava mais Sale via vendaspdv (ver syncVendas).
async function syncFaturas(client: DapicClient, storeId: string | null, dias: number, priceCatalog: PriceCatalog) {
  if (!storeId || client.label !== "cd-atacado") return { vendas: 0, brindes: 0 };
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - dias);
  const faturas = await client.fetchFaturas(toDateStr(inicio), toDateStr(hoje));

  const saleData: Prisma.SaleCreateManyInput[] = [];
  const giftData: Prisma.GiftCreateManyInput[] = [];
  for (const fatura of faturas) {
    if (fatura.Status !== "Fechado" || !fatura.DataFechamento) continue;
    const saleDate = parseDapicDateTime(fatura.DataFechamento);
    const produtos = await client.fetchFaturaProdutos(fatura.Id);

    produtos.forEach((item, itemIndex) => {
      if (item.Tipo === "Brinde") {
        giftData.push({
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
          quantidade: item.Quantidade,
          valorTotalLiquido: item.Valores.ValorTotal,
          giftDate: saleDate,
        });
        return;
      }
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
        tabelaPreco: inferTabelaPreco(String(item.IdGradeProduto), item.Valores.ValorUnitario, priceCatalog),
        saleDate,
      });
    });
  }
  if (giftData.length) await prisma.gift.createMany({ data: giftData, skipDuplicates: true });

  if (saleData.length) await prisma.sale.createMany({ data: saleData, skipDuplicates: true });
  return { vendas: saleData.length, brindes: giftData.length };
}

// Ordem de produção (token "matriz", separado das 4 lojas físicas — não vende nada, só dá acesso
// a esse endpoint). Volume é pequeno (~2300 linhas, 82 ordens desde 2025-08-22, testado em
// 2026-08-10: não existe nada mais antigo que isso), então busca o histórico completo a cada
// sync em vez de janela — mais simples e garante que status de ordens antigas ainda abertas
// (EmProducao/AguardandoInicio) seja atualizado quando finalizarem, sem depender de acertar o
// campo certo de filtro de data da API.
const ORDENS_PRODUCAO_DATA_INICIAL = "2018-01-01";

async function syncOrdensProducao(client: DapicClient | undefined) {
  if (!client) return 0;
  const linhas = await client.fetchOrdensProducaoProdutos(ORDENS_PRODUCAO_DATA_INICIAL, toDateStr(new Date()));
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
  return upsertProductionOrders(prisma, rows);
}

function formatProduto(pos: number, p: string, estoque: number, vendido: number) {
  return `${pos}. ${p} (estoque ${estoque}, vendeu ${vendido})`;
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
        incentivar.map((p, i) => formatProduto(i + 1, p.produto, p.estoque, p.vendido)).join("\n")
    );
  }

  if (porLoja.length) {
    partes.push(
      "\n🏆 Mais vendidos por loja (últimas 24h):\n" +
        porLoja
          .map(
            (l) =>
              `${l.storeName}:\n` +
              l.produtos.map((p, i) => `  ${i + 1}. ${p.produto} (${p.quantidade})`).join("\n")
          )
          .join("\n")
    );
  }

  return partes.join("\n");
}

// "Mais vendidos por loja" sempre olha as últimas 24h fixas — não mais "desde o último sync"
// (essa lógica dinâmica, com piso de 12h, podia cair majoritariamente numa janela de madrugada
// sem movimento das lojas físicas e mostrar só o canal online, mesmo com as lojas tendo vendido
// normalmente fora dessa janela estreita — achado pelo Rodrigo em 2026-08-12). 24h fixas cobre
// sempre o dia inteiro de operação de qualquer loja.
const JANELA_RESUMO_HORAS = 24;

export async function runSync() {
  const desde = new Date(Date.now() - JANELA_RESUMO_HORAS * 60 * 60 * 1000);

  try {
    // "matriz" não vende nada (só existe pra dar acesso a /ordensproducao/produtos) — incluir ela
    // no loop de estoque/vendas abaixo duplicaria a busca de estoque das outras lojas (o token da
    // matriz enxerga tudo) e arriscaria timeout de novo à toa. Sincronizada à parte, em paralelo.
    const allClients = createDapicClients();
    const clients = allClients.filter((c) => c.label !== "matriz");
    const matrizClient = allClients.find((c) => c.label === "matriz");

    // Lojas em paralelo, não em sequência — cada uma leva dezenas de segundos pra buscar o
    // estoque completo na API do DAPIC, e rodando uma por vez as 4 juntas passavam dos 300s
    // (maxDuration) e a função da Vercel dava timeout, quebrando a sync automática.
    const [results, totalOrdensProducao] = await Promise.all([
      Promise.all(
        clients.map(async (client) => {
          const t0 = Date.now();
          const { storeByDapicId, primaryStoreId } = await syncArmazenadores(client);
          const t1 = Date.now();
          const [estoque, priceCatalog] = await Promise.all([
            syncEstoque(client, storeByDapicId),
            fetchPriceCatalog(client),
          ]);
          const t2 = Date.now();
          // Janela de 1 dia (24h) — cobre com folga o intervalo entre os 2 syncs diários (12h) e
          // reduz o volume processado (menos chamadas de /faturas, que é 1 por fatura pro
          // Site+Atacado). Reduzido de 2 pra 1 dia em 2026-08-12 depois de um clique manual do
          // Rodrigo estourar os 300s da Vercel. Se um sync falhar, o self-heal-sync.ts (dispara
          // sozinho se o último SyncLog tiver mais de 5h) cobre o risco de perder dado mais velho
          // que essa janela.
          const vendas = await syncVendas(client, primaryStoreId, 1, priceCatalog);
          const t3 = Date.now();
          const faturas = await syncFaturas(client, primaryStoreId, 1, priceCatalog);
          const t4 = Date.now();
          // Instrumentação temporária pra achar o gargalo real (2026-08-12) — remover depois.
          console.log(
            `[sync-timing] ${client.label}: armazenadores=${t1 - t0}ms estoque+preco=${t2 - t1}ms vendas=${t3 - t2}ms faturas=${t4 - t3}ms total=${t4 - t0}ms`
          );
          return {
            estoque,
            vendas: vendas.vendas + faturas.vendas,
            devolucoes: vendas.devolucoes,
            brindes: vendas.brindes + faturas.brindes,
            timing: `${client.label}:arm=${t1 - t0}ms,est+preco=${t2 - t1}ms,vend=${t3 - t2}ms,fat=${t4 - t3}ms,tot=${t4 - t0}ms`,
          };
        })
      ),
      // Não fatal: se o token da matriz ainda não estiver configurado (ex: só em dev, não em
      // produção), syncOrdensProducao devolve 0 sem quebrar o resto da sync.
      syncOrdensProducao(matrizClient).catch(() => 0),
    ]);

    const totalEstoque = results.reduce((a, r) => a + r.estoque, 0);
    const totalVendas = results.reduce((a, r) => a + r.vendas, 0);
    const totalDevolucoes = results.reduce((a, r) => a + r.devolucoes, 0);
    const totalBrindes = results.reduce((a, r) => a + r.brindes, 0);

    await prisma.syncLog.create({
      data: {
        source: "STOCK",
        status: "SUCCESS",
        recordsSynced: totalEstoque,
        // Instrumentação temporária (2026-08-12) — remover depois de achar o gargalo.
        message: results.map((r) => r.timing).join(" | "),
        finishedAt: new Date(),
      },
    });
    await prisma.syncLog.create({
      data: { source: "SALES", status: "SUCCESS", recordsSynced: totalVendas, finishedAt: new Date() },
    });
    await prisma.syncLog.create({
      data: { source: "RETURNS", status: "SUCCESS", recordsSynced: totalDevolucoes, finishedAt: new Date() },
    });
    await prisma.syncLog.create({
      data: { source: "PRODUCTION", status: "SUCCESS", recordsSynced: totalOrdensProducao, finishedAt: new Date() },
    });
    await prisma.syncLog.create({
      data: { source: "GIFTS", status: "SUCCESS", recordsSynced: totalBrindes, finishedAt: new Date() },
    });

    const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const resumo = await buildResumoMessage(desde).catch(() => "");
    await sendTelegramMessage(`✅ Dashboard TVB atualizado (${agora})\n${resumo}`);

    return NextResponse.json({
      ok: true,
      lojas: clients.length,
      estoque: totalEstoque,
      vendas: totalVendas,
      devolucoes: totalDevolucoes,
      ordensProducao: totalOrdensProducao,
      brindes: totalBrindes,
    });
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
