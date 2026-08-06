-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VENDEDOR',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sellsProducts" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "valorTotalLiquido" REAL NOT NULL,
    "valorCustoTotal" REAL,
    "valorFrete" REAL,
    "saleDate" DATETIME NOT NULL,
    CONSTRAINT "Sale_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "cod" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "cor" TEXT,
    "tamanho" TEXT,
    "colecao" TEXT,
    "quantidadeDisponivel" INTEGER NOT NULL,
    "estoqueMinimo" INTEGER,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockSnapshot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Return" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "cod" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "cor" TEXT,
    "tamanho" TEXT,
    "quantidade" INTEGER NOT NULL,
    "valorTotal" REAL NOT NULL,
    "returnDate" DATETIME NOT NULL,
    CONSTRAINT "Return_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductionOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "grupo" TEXT NOT NULL,
    "referencia" TEXT,
    "produto" TEXT NOT NULL,
    "tamanho" TEXT,
    "quantidadeFinalizada" INTEGER NOT NULL,
    "dataPrevisao" DATETIME,
    "ordemProducao" TEXT NOT NULL,
    "cod" TEXT
);

-- CreateTable
CREATE TABLE "PriorityGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "grupo" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recordsSynced" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "SyncLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
