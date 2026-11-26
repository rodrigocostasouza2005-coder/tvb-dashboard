import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Diagnóstico temporário READ-ONLY (2026-11-26) — confirmar se a migration de
// DecisaoMovimentacaoEstoque (20261111160000) foi aplicada em producao. So metadado, sem dado.
export const maxDuration = 30;

function autorizado(request: NextRequest): boolean {
  const secret = request.headers.get("x-sync-secret") ?? new URL(request.url).searchParams.get("secret");
  return !!process.env.DIAG_MIGRATION_SECRET && secret === process.env.DIAG_MIGRATION_SECRET;
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tabelaExiste = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'DecisaoMovimentacaoEstoque'
    ) as exists
  `;

  const migrationsAplicadas = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM "_prisma_migrations"
    WHERE migration_name LIKE '%decisao_movimentacao%'
  `;

  return NextResponse.json({
    tabelaExiste: tabelaExiste[0]?.exists ?? false,
    migrationsRegistradas: migrationsAplicadas.map((m) => m.migration_name),
  });
}
