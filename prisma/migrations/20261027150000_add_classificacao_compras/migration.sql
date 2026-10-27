
-- CreateEnum
CREATE TYPE "TipoCompraProduto" AS ENUM ('BEST_SELLER', 'DROP');

-- CreateEnum
CREATE TYPE "StatusComercialProduto" AS ENUM ('ATIVO', 'EM_LANCAMENTO', 'EM_REPOSICAO', 'EM_ENCERRAMENTO', 'DESCONTINUADO');

-- CreateEnum
CREATE TYPE "PossibilidadeReposicao" AS ENUM ('SIM', 'NAO', 'A_CONFIRMAR');

-- AlterTable
ALTER TABLE "CoberturaMeta" ADD COLUMN     "estoqueSegurancaUnidades" INTEGER,
ADD COLUMN     "leadTimeDias" INTEGER;

-- AlterTable
ALTER TABLE "MapaComprasConfig" ADD COLUMN     "orcamentoTotalPlanejado" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ClassificacaoProduto" (
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
);

-- CreateTable
CREATE TABLE "ClassificacaoProdutoHistorico" (
    "id" TEXT NOT NULL,
    "classificacaoId" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "valorAnterior" TEXT,
    "valorNovo" TEXT,
    "alteradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoPor" TEXT,

    CONSTRAINT "ClassificacaoProdutoHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisaoCompra" (
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
);

-- CreateIndex
CREATE UNIQUE INDEX "ClassificacaoProduto_cod_key" ON "ClassificacaoProduto"("cod");

-- CreateIndex
CREATE INDEX "ClassificacaoProduto_grupo_idx" ON "ClassificacaoProduto"("grupo");

-- CreateIndex
CREATE INDEX "ClassificacaoProduto_tipoCompra_idx" ON "ClassificacaoProduto"("tipoCompra");

-- CreateIndex
CREATE INDEX "ClassificacaoProduto_colecao_idx" ON "ClassificacaoProduto"("colecao");

-- CreateIndex
CREATE INDEX "ClassificacaoProdutoHistorico_classificacaoId_idx" ON "ClassificacaoProdutoHistorico"("classificacaoId");

-- CreateIndex
CREATE INDEX "DecisaoCompra_grupo_idx" ON "DecisaoCompra"("grupo");

-- CreateIndex
CREATE INDEX "DecisaoCompra_cod_idx" ON "DecisaoCompra"("cod");

-- AddForeignKey
ALTER TABLE "ClassificacaoProdutoHistorico" ADD CONSTRAINT "ClassificacaoProdutoHistorico_classificacaoId_fkey" FOREIGN KEY ("classificacaoId") REFERENCES "ClassificacaoProduto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

