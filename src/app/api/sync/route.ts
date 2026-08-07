import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  fetchArmazenadores,
  fetchEstoqueTodosArmazenadores,
  fetchPedidosVendas,
  fetchPedidoVendaDetalhe,
} from "@/lib/connectors/dapic";
import { sendTelegramMessage } from "@/lib/telegram";
import type { Prisma } from "@prisma/client";

// Chamado por um agendador externo (cron-job.org, GitHub Actions, etc) 2x/dia, às 8h e 17h.
// Protegido por um segredo compartilhado porque não tem login de usuário por trás dela.
const CANAIS_DE_VENDA = new Set(["CD", "ATACADO"]);

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // 1. Armazenadores (garante que toda loja/armazenador tenha um Store correspondente)
    const armazenadores = await fetchArmazenadores();
    const storeByDapicId = new Map<number, string>();
    for (const a of armazenadores) {
      const existing = await prisma.store.findFirst({
        where: { OR: [{ code: a.Descricao }, { dapicArmazenadorId: a.Id }] },
      });
      const store = existing
        ? await prisma.store.update({ where: { id: existing.id }, data: { dapicArmazenadorId: a.Id } })
        : await prisma.store.create({
            data: {
              code: a.Descricao,
              name: a.Descricao,
              dapicArmazenadorId: a.Id,
              sellsProducts: CANAIS_DE_VENDA.has(a.Descricao),
            },
          });
      storeByDapicId.set(a.Id, store.id);
    }

    // 2. Estoque (todos os armazenadores de uma vez)
    const linhas = await fetchEstoqueTodosArmazenadores();
    const stockData: Prisma.StockSnapshotCreateManyInput[] = [];
    for (const l of linhas) {
      const storeId = storeByDapicId.get(l.IdArmazenador);
      if (!storeId) continue;
      stockData.push({
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
    if (stockData.length) await prisma.stockSnapshot.createMany({ data: stockData });

    await prisma.syncLog.create({
      data: { source: "STOCK", status: "SUCCESS", recordsSynced: stockData.length, finishedAt: new Date() },
    });

    // 3. Vendas dos últimos 2 dias (cobre o intervalo desde a última sync 2x/dia com folga)
    const cdStore = await prisma.store.findFirst({ where: { code: "CD" } });
    let salesCount = 0;
    if (cdStore) {
      const hoje = new Date();
      const inicio = new Date(hoje);
      inicio.setDate(inicio.getDate() - 2);
      const resumos = await fetchPedidosVendas(toDateStr(inicio), toDateStr(hoje));

      const salesData: Prisma.SaleCreateManyInput[] = [];
      for (const resumo of resumos) {
        const detalhe = await fetchPedidoVendaDetalhe(resumo.Id);
        for (const item of detalhe.Produtos) {
          salesData.push({
            storeId: cdStore.id,
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
      if (salesData.length) await prisma.sale.createMany({ data: salesData });
      salesCount = salesData.length;
    }

    await prisma.syncLog.create({
      data: { source: "SALES", status: "SUCCESS", recordsSynced: salesCount, finishedAt: new Date() },
    });

    const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    await sendTelegramMessage(
      `✅ Dashboard TVB atualizado (${agora})\nEstoque: ${stockData.length} linhas\nVendas: ${salesCount} itens`
    );

    return NextResponse.json({ ok: true, armazenadores: armazenadores.length, estoque: stockData.length, vendas: salesCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { source: "STOCK", status: "FAILED", message, finishedAt: new Date() },
    });
    await sendTelegramMessage(`⚠️ Falha ao atualizar o Dashboard TVB: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
