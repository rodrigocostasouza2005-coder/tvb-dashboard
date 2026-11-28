import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Aplica a migration 20261127170000_add_crescimento_premissas em produção (2026-11-28) — motor de
// Premissas de Crescimento do Mapa de Compras 2.0 (PR #137). Mesmo padrão já usado em
// aplicar-migration-compras/route.ts e aplicar-migration-armazem-conhecido/route.ts: autenticação
// via EXTERNAL_SYNC_SECRET (header x-sync-secret ou ?secret=), conexão usando a DATABASE_URL que a
// própria Vercel injeta nesta função (nunca passa por fora). Todo statement é IF NOT EXISTS /
// DO-block com EXCEPTION WHEN duplicate_object — idempotente, só CREATE/ADD, nunca DROP. Remover
// esta rota depois de confirmar aplicado (mesmo ciclo de vida das rotas anteriores).
export const maxDuration = 60;

function autorizado(request: NextRequest): boolean {
  const secret = request.headers.get("x-sync-secret") ?? new URL(request.url).searchParams.get("secret");
  return !!process.env.EXTERNAL_SYNC_SECRET && secret === process.env.EXTERNAL_SYNC_SECRET;
}

const STATEMENTS: string[] = [
  `ALTER TABLE "MapaComprasConfig" ADD COLUMN IF NOT EXISTS "cenarioAtivo" TEXT NOT NULL DEFAULT 'base';`,
  `CREATE TABLE IF NOT EXISTS "CrescimentoCenario" (
    "id" TEXT NOT NULL,
    "crescimentoPct" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrescimentoCenario_pkey" PRIMARY KEY ("id")
  );`,
  `CREATE TABLE IF NOT EXISTS "CrescimentoAjusteLoja" (
    "id" TEXT NOT NULL,
    "posicaoId" TEXT NOT NULL,
    "multiplicador" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrescimentoAjusteLoja_pkey" PRIMARY KEY ("id")
  );`,
  `CREATE TABLE IF NOT EXISTS "CrescimentoAjusteGrupo" (
    "id" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "multiplicador" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrescimentoAjusteGrupo_pkey" PRIMARY KEY ("id")
  );`,
  `CREATE TABLE IF NOT EXISTS "CrescimentoAjusteMensal" (
    "id" TEXT NOT NULL,
    "mesCalendario" INTEGER NOT NULL,
    "ajustePontos" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrescimentoAjusteMensal_pkey" PRIMARY KEY ("id")
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CrescimentoAjusteLoja_posicaoId_key" ON "CrescimentoAjusteLoja"("posicaoId");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CrescimentoAjusteGrupo_grupo_key" ON "CrescimentoAjusteGrupo"("grupo");`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CrescimentoAjusteMensal_mesCalendario_key" ON "CrescimentoAjusteMensal"("mesCalendario");`,
];

async function handle(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Hostname só (nunca a connection string inteira) — confirma o destino sem expor segredo.
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return null;
    }
  })();

  const aplicados: number[] = [];
  try {
    await prisma.$transaction(STATEMENTS.map((sql) => prisma.$executeRawUnsafe(sql)));
    for (let i = 0; i < STATEMENTS.length; i++) aplicados.push(i);
  } catch (error) {
    return NextResponse.json(
      { ok: false, host, erro: error instanceof Error ? error.message : String(error), aplicadosAntesDoErro: aplicados },
      { status: 500 }
    );
  }

  // Verificação real pós-aplicação: as mesmas tabelas/coluna novas, via query real do Prisma.
  try {
    await prisma.mapaComprasConfig.findUnique({ where: { id: "global" }, select: { cenarioAtivo: true } });
    await prisma.crescimentoCenario.findMany({ take: 1 });
    await prisma.crescimentoAjusteLoja.findMany({ take: 1 });
    await prisma.crescimentoAjusteGrupo.findMany({ take: 1 });
    await prisma.crescimentoAjusteMensal.findMany({ take: 1 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, host, etapa: "verificacao-pos-migration", erro: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, host, statementsExecutados: STATEMENTS.length, verificacao: "tabelas e coluna confirmadas via query real" });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
