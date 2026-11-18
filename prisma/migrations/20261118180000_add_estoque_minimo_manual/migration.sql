-- CreateTable
CREATE TABLE "EstoqueMinimoManual" (
    "id" TEXT NOT NULL,
    "cod" TEXT NOT NULL,
    "valor" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "atualizadoPor" TEXT,

    CONSTRAINT "EstoqueMinimoManual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstoqueMinimoManualHistorico" (
    "id" TEXT NOT NULL,
    "estoqueMinimoManualId" TEXT NOT NULL,
    "valorAnterior" INTEGER,
    "valorNovo" INTEGER,
    "alteradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoPor" TEXT,

    CONSTRAINT "EstoqueMinimoManualHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EstoqueMinimoManual_cod_key" ON "EstoqueMinimoManual"("cod");

-- CreateIndex
CREATE INDEX "EstoqueMinimoManualHistorico_estoqueMinimoManualId_idx" ON "EstoqueMinimoManualHistorico"("estoqueMinimoManualId");

-- AddForeignKey
ALTER TABLE "EstoqueMinimoManualHistorico" ADD CONSTRAINT "EstoqueMinimoManualHistorico_estoqueMinimoManualId_fkey" FOREIGN KEY ("estoqueMinimoManualId") REFERENCES "EstoqueMinimoManual"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
