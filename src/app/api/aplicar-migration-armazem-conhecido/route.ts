import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Aplica a migration 20261031180000_add_armazem_conhecido em produção — mesmo problema estrutural
// documentado em /api/aplicar-migration-compras (build da Vercel só roda `next build`, nunca
// `prisma migrate deploy`; schema novo só chega em produção se alguém aplicar manualmente). Sem
// essa tabela, verificarArmazemNovo() cai sempre no branch de erro genérico (prisma.armazemConhecido
// não existe) e volta a repetir o alerta de "armazém novo" em toda sincronização — exatamente o
// bug que essa entrega corrige, então a migration é parte obrigatória do deploy, não opcional.
//
// Mesmo contrato de autenticação dos outros endpoints de operação (EXTERNAL_SYNC_SECRET +
// header x-sync-secret) — a conexão com o banco usa a DATABASE_URL que a própria Vercel injeta
// nesta função, nunca passa por fora.
export const maxDuration = 30;

function autorizado(request: NextRequest): boolean {
  const secret = request.headers.get("x-sync-secret") ?? new URL(request.url).searchParams.get("secret");
  return !!process.env.EXTERNAL_SYNC_SECRET && secret === process.env.EXTERNAL_SYNC_SECRET;
}

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "ArmazemConhecido" (
    "id" TEXT NOT NULL,
    "clientLabel" TEXT NOT NULL,
    "dapicArmazenadorId" INTEGER NOT NULL,
    "nomeAtual" TEXT NOT NULL,
    "classificacao" TEXT NOT NULL,
    "primeiraVezVistoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ArmazemConhecido_pkey" PRIMARY KEY ("id")
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ArmazemConhecido_clientLabel_dapicArmazenadorId_key" ON "ArmazemConhecido"("clientLabel", "dapicArmazenadorId");`,
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
    await prisma.$transaction(STATEMENTS.map((sql) => prisma.$executeRawUnsafe(sql)));
    for (let i = 0; i < STATEMENTS.length; i++) aplicados.push(i);
  } catch (error) {
    return NextResponse.json(
      { ok: false, host, erro: error instanceof Error ? error.message : String(error), aplicadosAntesDoErro: aplicados },
      { status: 500 }
    );
  }

  try {
    await prisma.armazemConhecido.findMany({ take: 1 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, host, etapa: "verificacao-pos-migration", erro: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, host, statementsExecutados: STATEMENTS.length, verificacao: "tabela ArmazemConhecido confirmada via query real" });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
