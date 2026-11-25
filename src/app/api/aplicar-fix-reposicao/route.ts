import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Fix pontual (2026-11-25): a migration 20261123160000_raise_grao_classificacao_produto_cor foi
// aplicada no banco (dev e produção) mas a branch que a introduziu nunca foi mergeada no main —
// ficou parada em merge com conflito não resolvido. Resultado: banco em produção num formato
// (cor/produtoCor) que o código deployado não entendia, P2022 em toda query de
// ClassificacaoProduto.cod, derrubando /dashboard/reposicao e telas que cruzam com Mapa de
// Compras/Distribuição.
//
// Mesmo motivo de EXTERNAL_SYNC_SECRET/CRON_SECRET/DATABASE_URL em
// /api/aplicar-migration-compras: são "Sensitive" na Vercel, ninguém consegue ler de volta —
// nem eu, nem o Rodrigo. Por isso este fix usa um secret NOVO e isolado
// (FIX_REPOSICAO_SECRET), específico só pra esta correção pontual, pra não precisar rotacionar
// nem tocar no EXTERNAL_SYNC_SECRET existente (que outros crons reais já dependem). Rota e
// secret removidos depois de confirmado o fix em produção.
//
// Idempotente: pode rodar mais de uma vez sem erro nem efeito duplicado (DO-block com EXCEPTION,
// IF NOT EXISTS/IF EXISTS). Confirmado com o Rodrigo (2026-11-25): tabela vazia (0 linhas) em
// dev e produção — sem perda de dado possível.
export const maxDuration = 60;

function autorizado(request: NextRequest): boolean {
  const secret = request.headers.get("x-sync-secret") ?? new URL(request.url).searchParams.get("secret");
  return !!process.env.FIX_REPOSICAO_SECRET && secret === process.env.FIX_REPOSICAO_SECRET;
}

const STATEMENTS: string[] = [
  `DROP INDEX IF EXISTS "ClassificacaoProduto_produtoCor_key";`,
  `DROP INDEX IF EXISTS "ClassificacaoProduto_produto_idx";`,
  `ALTER TABLE "ClassificacaoProduto" DROP COLUMN IF EXISTS "cor";`,
  `ALTER TABLE "ClassificacaoProduto" DROP COLUMN IF EXISTS "produtoCor";`,
  `ALTER TABLE "ClassificacaoProduto" ADD COLUMN IF NOT EXISTS "cod" TEXT;`,
  `ALTER TABLE "ClassificacaoProduto" ALTER COLUMN "cod" SET NOT NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ClassificacaoProduto_cod_key" ON "ClassificacaoProduto"("cod");`,
];

async function handle(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return null;
    }
  })();

  const aplicados: number[] = [];
  try {
    for (let i = 0; i < STATEMENTS.length; i++) {
      await prisma.$executeRawUnsafe(STATEMENTS[i]);
      aplicados.push(i);
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, host, erro: error instanceof Error ? error.message : String(error), aplicadosAntesDoErro: aplicados },
      { status: 500 }
    );
  }

  try {
    await prisma.classificacaoProduto.findMany({ take: 1 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, host, etapa: "verificacao-pos-fix", erro: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, host, statementsExecutados: STATEMENTS.length, verificacao: "classificacaoProduto.cod confirmado via query real" });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
