import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Aplica a migration 20261027150000_add_classificacao_compras em produção (2026-10-27) — o
// Mapa de Compras foi publicado com o schema novo (ClassificacaoProduto/DecisaoCompra/colunas em
// CoberturaMeta/MapaComprasConfig) só aplicado no Neon dev via `prisma db push`, nunca em
// produção (erro real: P2022 "CoberturaMeta.estoqueSegurancaUnidades does not exist"). Mesmo
// contrato de autenticação de /api/sync-frequent e /api/recuperar-vendas (EXTERNAL_SYNC_SECRET +
// header x-sync-secret, não CRON_SECRET/DATABASE_URL, que são "Sensitive" na Vercel e não podem
// ser lidos de volta por ninguém — nem por mim, nem pelo Rodrigo, nem por um secret do GitHub
// Actions). A conexão com o banco acontece AQUI DENTRO, usando a DATABASE_URL que a própria
// Vercel já injeta nesta função — nunca passa pelo GitHub Actions.
//
// Todo statement usa IF NOT EXISTS / DO-block com EXCEPTION WHEN duplicate_object — idempotente
// de propósito: pode rodar quantas vezes precisar, mesmo se uma tentativa anterior já tiver
// aplicado parte do schema, sem duplicar estrutura nem apagar dado nenhum (só CREATE/ADD, nunca
// DROP). Conteúdo idêntico ao commit 8035859 (prisma/migrations/20261027150000_.../migration.sql)
// — só adiciona as guardas de idempotência, não muda nenhum tipo/coluna/índice.
export const maxDuration = 60;

function autorizado(request: NextRequest): boolean {
  const secret = request.headers.get("x-sync-secret") ?? new URL(request.url).searchParams.get("secret");
  return !!process.env.EXTERNAL_SYNC_SECRET && secret === process.env.EXTERNAL_SYNC_SECRET;
}

const STATEMENTS: string[] = [
  `DO $$ BEGIN CREATE TYPE "TipoCompraProduto" AS ENUM ('BEST_SELLER', 'DROP'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN CREATE TYPE "StatusComercialProduto" AS ENUM ('ATIVO', 'EM_LANCAMENTO', 'EM_REPOSICAO', 'EM_ENCERRAMENTO', 'DESCONTINUADO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN CREATE TYPE "PossibilidadeReposicao" AS ENUM ('SIM', 'NAO', 'A_CONFIRMAR'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `ALTER TABLE "CoberturaMeta" ADD COLUMN IF NOT EXISTS "estoqueSegurancaUnidades" INTEGER;`,
  `ALTER TABLE "CoberturaMeta" ADD COLUMN IF NOT EXISTS "leadTimeDias" INTEGER;`,
  `ALTER TABLE "MapaComprasConfig" ADD COLUMN IF NOT EXISTS "orcamentoTotalPlanejado" DOUBLE PRECISION;`,
  `CREATE TABLE IF NOT EXISTS "ClassificacaoProduto" (
    "id" TEXT NOT NULL,
    "cod" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "colecao" TEXT,
    "tipoCompra" "TipoCompraProduto" NOT NULL,
    "statusComercial" "StatusComercialProduto" NOT NULL,
    "possibilidadeReposicao" "PossibilidadeReposicao" NOT NULL,
    "dataLancamento" TIMESTAMP(3),
    "dataEncerramentoPrevista" TIMESTAMP(3),
    "orcamentoDrop" DOUBLE PRECISION,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClassificacaoProduto_pkey" PRIMARY KEY ("id")
  );`,
  `CREATE TABLE IF NOT EXISTS "ClassificacaoProdutoHistorico" (
    "id" TEXT NOT NULL,
    "classificacaoId" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "valorAnterior" TEXT,
    "valorNovo" TEXT,
    "alteradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoPor" TEXT,
    CONSTRAINT "ClassificacaoProdutoHistorico_pkey" PRIMARY KEY ("id")
  );`,
  `CREATE TABLE IF NOT EXISTS "DecisaoCompra" (
    "id" TEXT NOT NULL,
    "cod" TEXT,
    "grupo" TEXT NOT NULL,
    "tipoCompra" "TipoCompraProduto" NOT NULL,
    "quantidadeSugerida" INTEGER NOT NULL,
    "quantidadeAprovada" INTEGER NOT NULL,
    "justificativaAjuste" TEXT,
    "premissas" JSONB NOT NULL,
    "decididoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decididoPor" TEXT,
    CONSTRAINT "DecisaoCompra_pkey" PRIMARY KEY ("id")
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ClassificacaoProduto_cod_key" ON "ClassificacaoProduto"("cod");`,
  `CREATE INDEX IF NOT EXISTS "ClassificacaoProduto_grupo_idx" ON "ClassificacaoProduto"("grupo");`,
  `CREATE INDEX IF NOT EXISTS "ClassificacaoProduto_tipoCompra_idx" ON "ClassificacaoProduto"("tipoCompra");`,
  `CREATE INDEX IF NOT EXISTS "ClassificacaoProduto_colecao_idx" ON "ClassificacaoProduto"("colecao");`,
  `CREATE INDEX IF NOT EXISTS "ClassificacaoProdutoHistorico_classificacaoId_idx" ON "ClassificacaoProdutoHistorico"("classificacaoId");`,
  `CREATE INDEX IF NOT EXISTS "DecisaoCompra_grupo_idx" ON "DecisaoCompra"("grupo");`,
  `CREATE INDEX IF NOT EXISTS "DecisaoCompra_cod_idx" ON "DecisaoCompra"("cod");`,
  `DO $$ BEGIN
    ALTER TABLE "ClassificacaoProdutoHistorico" ADD CONSTRAINT "ClassificacaoProdutoHistorico_classificacaoId_fkey"
      FOREIGN KEY ("classificacaoId") REFERENCES "ClassificacaoProduto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
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
    await prisma.$transaction(
      STATEMENTS.map((sql) => prisma.$executeRawUnsafe(sql)),
    );
    for (let i = 0; i < STATEMENTS.length; i++) aplicados.push(i);
  } catch (error) {
    return NextResponse.json(
      { ok: false, host, erro: error instanceof Error ? error.message : String(error), aplicadosAntesDoErro: aplicados },
      { status: 500 }
    );
  }

  // Verificação real pós-aplicação: as MESMAS queries que estavam quebrando em produção
  // (P2022). Se chegar aqui sem lançar, o schema está correto de ponta a ponta.
  try {
    await prisma.coberturaMeta.findMany({ take: 1 });
    await prisma.mapaComprasConfig.findUnique({ where: { id: "global" } });
    await prisma.classificacaoProduto.findMany({ take: 1 });
    await prisma.decisaoCompra.findMany({ take: 1 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, host, etapa: "verificacao-pos-migration", erro: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, host, statementsExecutados: STATEMENTS.length, verificacao: "tabelas e colunas confirmadas via query real" });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
