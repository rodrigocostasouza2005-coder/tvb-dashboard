-- CreateEnum
CREATE TYPE "TipoMovimentacaoEstoque" AS ENUM ('LOJA_LOJA', 'CD_SITE_LOJA', 'LOJA_CD_SITE');

-- CreateEnum
CREATE TYPE "ClassificacaoMovimentacaoEstoque" AS ENUM ('REDISTRIBUIR', 'RECOLHER_PARA_CD_SITE', 'MANTER');

-- CreateEnum
CREATE TYPE "StatusMovimentacaoEstoque" AS ENUM ('PENDENTE', 'APROVADA', 'EXECUTADA', 'RECUSADA');

-- CreateTable
CREATE TABLE "DecisaoMovimentacaoEstoque" (
    "id" TEXT NOT NULL,
    "cod" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "cor" TEXT,
    "tamanho" TEXT,
    "origemPosicaoId" TEXT NOT NULL,
    "origemNome" TEXT NOT NULL,
    "destinoPosicaoId" TEXT NOT NULL,
    "destinoNome" TEXT NOT NULL,
    "tipoMovimentacao" "TipoMovimentacaoEstoque" NOT NULL,
    "classificacao" "ClassificacaoMovimentacaoEstoque" NOT NULL,
    "quantidadeSugerida" INTEGER NOT NULL,
    "quantidadeAprovada" INTEGER,
    "quantidadeExecutada" INTEGER,
    "status" "StatusMovimentacaoEstoque" NOT NULL DEFAULT 'PENDENTE',
    "confianca" TEXT NOT NULL,
    "premissas" JSONB NOT NULL,
    "recomendadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decididoEm" TIMESTAMP(3),
    "decididoPor" TEXT,
    "executadoEm" TIMESTAMP(3),
    "executadoPor" TEXT,
    "observacao" TEXT,

    CONSTRAINT "DecisaoMovimentacaoEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DecisaoMovimentacaoEstoque_cod_idx" ON "DecisaoMovimentacaoEstoque"("cod");

-- CreateIndex
CREATE INDEX "DecisaoMovimentacaoEstoque_status_idx" ON "DecisaoMovimentacaoEstoque"("status");

-- CreateIndex
CREATE INDEX "DecisaoMovimentacaoEstoque_recomendadoEm_idx" ON "DecisaoMovimentacaoEstoque"("recomendadoEm");

