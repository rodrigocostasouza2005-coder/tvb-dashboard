-- CreateTable
CREATE TABLE "StockSnapshotDiario" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "cod" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "cor" TEXT,
    "tamanho" TEXT,
    "colecao" TEXT,
    "quantidadeDisponivel" INTEGER NOT NULL,
    "valorCusto" DOUBLE PRECISION,
    "data" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockSnapshotDiario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockSnapshotDiario_cod_data_idx" ON "StockSnapshotDiario"("cod", "data");

-- CreateIndex
CREATE INDEX "StockSnapshotDiario_data_idx" ON "StockSnapshotDiario"("data");

-- CreateIndex
CREATE INDEX "StockSnapshotDiario_grupo_idx" ON "StockSnapshotDiario"("grupo");

-- CreateIndex
CREATE UNIQUE INDEX "StockSnapshotDiario_storeId_cod_data_key" ON "StockSnapshotDiario"("storeId", "cod", "data");

-- AddForeignKey
ALTER TABLE "StockSnapshotDiario" ADD CONSTRAINT "StockSnapshotDiario_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
