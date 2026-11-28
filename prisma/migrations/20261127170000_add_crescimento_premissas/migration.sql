-- AlterTable
ALTER TABLE "MapaComprasConfig" ADD COLUMN     "cenarioAtivo" TEXT NOT NULL DEFAULT 'base';

-- CreateTable
CREATE TABLE "CrescimentoCenario" (
    "id" TEXT NOT NULL,
    "crescimentoPct" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrescimentoCenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrescimentoAjusteLoja" (
    "id" TEXT NOT NULL,
    "posicaoId" TEXT NOT NULL,
    "multiplicador" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrescimentoAjusteLoja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrescimentoAjusteGrupo" (
    "id" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "multiplicador" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrescimentoAjusteGrupo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrescimentoAjusteMensal" (
    "id" TEXT NOT NULL,
    "mesCalendario" INTEGER NOT NULL,
    "ajustePontos" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrescimentoAjusteMensal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrescimentoAjusteLoja_posicaoId_key" ON "CrescimentoAjusteLoja"("posicaoId");

-- CreateIndex
CREATE UNIQUE INDEX "CrescimentoAjusteGrupo_grupo_key" ON "CrescimentoAjusteGrupo"("grupo");

-- CreateIndex
CREATE UNIQUE INDEX "CrescimentoAjusteMensal_mesCalendario_key" ON "CrescimentoAjusteMensal"("mesCalendario");
