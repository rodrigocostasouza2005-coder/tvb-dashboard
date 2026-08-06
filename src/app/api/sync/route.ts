import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchStoreDataFromDapic } from "@/lib/connectors/dapic";

// Chamada por um agendador externo (cron-job.org, GitHub Actions, etc) 2x/dia,
// às 8h e às 17h, uma vez por loja. Protegida por um segredo compartilhado
// porque não tem login de usuário por trás dela.
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeCode = searchParams.get("store");
  if (!storeCode) {
    return NextResponse.json({ error: "missing 'store' query param" }, { status: 400 });
  }

  const store = await prisma.store.findUnique({ where: { code: storeCode } });
  if (!store) {
    return NextResponse.json({ error: `loja "${storeCode}" não encontrada` }, { status: 404 });
  }

  try {
    const data = await fetchStoreDataFromDapic(storeCode);

    await prisma.sale.createMany({
      data: data.sales.map((row) => ({
        storeId: store.id,
        cod: row.cod,
        produto: row.produto,
        grupo: row.grupo,
        cor: row.cor,
        tamanho: row.tamanho,
        marca: row.marca,
        clienteNome: row.clienteNome,
        vendedor: row.vendedor,
        tabelaPreco: row.tabelaPreco,
        cidade: row.cidade,
        estado: row.estado,
        quantidade: row.quantidade,
        valorTotalLiquido: row.valorTotalLiquido,
        valorCustoTotal: row.valorCustoTotal,
        valorFrete: row.valorFrete,
        saleDate: new Date(row.saleDate),
      })),
    });

    await prisma.stockSnapshot.createMany({
      data: data.stock.map((row) => ({
        storeId: store.id,
        cod: row.cod,
        produto: row.produto,
        grupo: row.grupo,
        cor: row.cor,
        tamanho: row.tamanho,
        colecao: row.colecao,
        quantidadeDisponivel: row.quantidadeDisponivel,
        estoqueMinimo: row.estoqueMinimo,
      })),
    });

    await prisma.syncLog.createMany({
      data: [
        {
          storeId: store.id,
          source: "SALES",
          status: "SUCCESS",
          recordsSynced: data.sales.length,
          finishedAt: new Date(),
        },
        {
          storeId: store.id,
          source: "STOCK",
          status: "SUCCESS",
          recordsSynced: data.stock.length,
          finishedAt: new Date(),
        },
      ],
    });

    return NextResponse.json({ ok: true, sales: data.sales.length, stock: data.stock.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { storeId: store.id, source: "SALES", status: "FAILED", finishedAt: new Date(), message },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
