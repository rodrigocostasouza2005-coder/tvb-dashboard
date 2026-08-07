-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'GESTAO', 'VENDEDOR');

-- CreateEnum
CREATE TYPE "SyncSource" AS ENUM ('SALES', 'STOCK', 'RETURNS', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VENDEDOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sellsProducts" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "cod" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "cor" TEXT,
    "tamanho" TEXT,
    "colecao" TEXT,
    "marca" TEXT,
    "clienteNome" TEXT,
    "vendedor" TEXT,
    "tabelaPreco" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "quantidade" INTEGER NOT NULL,
    "valorTotalLiquido" DOUBLE PRECISION NOT NULL,
    "valorCustoTotal" DOUBLE PRECISION,
    "valorFrete" DOUBLE PRECISION,
    "saleDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockSnapshot" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "cod" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "cor" TEXT,
    "tamanho" TEXT,
    "colecao" TEXT,
    "quantidadeDisponivel" INTEGER NOT NULL,
    "estoqueMinimo" INTEGER,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Return" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "cod" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "cor" TEXT,
    "tamanho" TEXT,
    "quantidade" INTEGER NOT NULL,
    "valorTotal" DOUBLE PRECISION NOT NULL,
    "returnDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Return_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrder" (
    "id" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "referencia" TEXT,
    "produto" TEXT NOT NULL,
    "tamanho" TEXT,
    "quantidadeFinalizada" INTEGER NOT NULL,
    "dataPrevisao" TIMESTAMP(3),
    "ordemProducao" TEXT NOT NULL,
    "cod" TEXT,

    CONSTRAINT "ProductionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriorityGroup" (
    "id" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,

    CONSTRAINT "PriorityGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "source" "SyncSource" NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "recordsSynced" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Store_code_key" ON "Store"("code");

-- CreateIndex
CREATE INDEX "Sale_storeId_saleDate_idx" ON "Sale"("storeId", "saleDate");

-- CreateIndex
CREATE INDEX "Sale_grupo_idx" ON "Sale"("grupo");

-- CreateIndex
CREATE INDEX "Sale_marca_idx" ON "Sale"("marca");

-- CreateIndex
CREATE INDEX "StockSnapshot_storeId_cod_syncedAt_idx" ON "StockSnapshot"("storeId", "cod", "syncedAt");

-- CreateIndex
CREATE INDEX "StockSnapshot_grupo_idx" ON "StockSnapshot"("grupo");

-- CreateIndex
CREATE INDEX "Return_storeId_returnDate_idx" ON "Return"("storeId", "returnDate");

-- CreateIndex
CREATE INDEX "ProductionOrder_grupo_idx" ON "ProductionOrder"("grupo");

-- CreateIndex
CREATE UNIQUE INDEX "PriorityGroup_grupo_key" ON "PriorityGroup"("grupo");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSnapshot" ADD CONSTRAINT "StockSnapshot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Return" ADD CONSTRAINT "Return_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
