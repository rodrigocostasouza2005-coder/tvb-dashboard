import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Rota de diagnóstico TEMPORÁRIA (2026-11-01) — só leitura, pra avaliar prontidão de volume/carga
// antes da Black Friday. Mesmo contrato de autenticação das outras rotas operacionais
// (EXTERNAL_SYNC_SECRET + header x-sync-secret). Remover depois da análise.
export const maxDuration = 60;

function autorizado(request: NextRequest): boolean {
  const secret = request.headers.get("x-sync-secret") ?? new URL(request.url).searchParams.get("secret");
  return !!process.env.EXTERNAL_SYNC_SECRET && secret === process.env.EXTERNAL_SYNC_SECRET;
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [sale, stock, returnCount, gift, prodOrder, armazemConhecido] = await Promise.all([
    prisma.sale.count(),
    prisma.stockSnapshot.count(),
    prisma.return.count(),
    prisma.gift.count(),
    prisma.productionOrder.count(),
    prisma.armazemConhecido.count(),
  ]);

  const porDia7d = await prisma.$queryRaw<{ dia: string; vendas: bigint }[]>`
    SELECT TO_CHAR("saleDate", 'YYYY-MM-DD') as dia, COUNT(*) as vendas
    FROM "Sale"
    WHERE "saleDate" >= NOW() - INTERVAL '7 days'
    GROUP BY dia ORDER BY dia
  `;

  const picoHistorico = await prisma.$queryRaw<{ dia: string; vendas: bigint }[]>`
    SELECT TO_CHAR("saleDate", 'YYYY-MM-DD') as dia, COUNT(*) as vendas
    FROM "Sale"
    GROUP BY dia ORDER BY vendas DESC LIMIT 10
  `;

  const picoEstoque30d = await prisma.$queryRaw<{ dia: string; syncs: bigint; maxDuracaoSeg: number | null }[]>`
    SELECT TO_CHAR("startedAt", 'YYYY-MM-DD') as dia, COUNT(*) as syncs,
      MAX(EXTRACT(EPOCH FROM ("finishedAt" - "startedAt"))) as "maxDuracaoSeg"
    FROM "SyncLog"
    WHERE "source" = 'STOCK' AND "startedAt" >= NOW() - INTERVAL '30 days' AND "finishedAt" IS NOT NULL
    GROUP BY dia ORDER BY dia DESC
  `;

  return NextResponse.json({
    totais: { sale, stock, returnCount, gift, prodOrder, armazemConhecido },
    vendasPorDiaUltimos7: porDia7d.map((r) => ({ dia: r.dia, vendas: Number(r.vendas) })),
    top10DiasComMaisVendas: picoHistorico.map((r) => ({ dia: r.dia, vendas: Number(r.vendas) })),
    duracaoSyncEstoquePorDia30d: picoEstoque30d.map((r) => ({ dia: r.dia, syncs: Number(r.syncs), maxDuracaoSeg: r.maxDuracaoSeg })),
  });
}
