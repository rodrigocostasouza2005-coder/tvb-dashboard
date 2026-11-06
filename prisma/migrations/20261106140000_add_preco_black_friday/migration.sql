-- CreateTable
CREATE TABLE "PrecoBlackFriday" (
    "id" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "colecao" TEXT,
    "precoCheio" DOUBLE PRECISION,
    "desconto" DOUBLE PRECISION NOT NULL,
    "precoComDesconto" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrecoBlackFriday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrecoBlackFriday_desconto_idx" ON "PrecoBlackFriday"("desconto");

-- CreateIndex
CREATE UNIQUE INDEX "PrecoBlackFriday_grupo_produto_key" ON "PrecoBlackFriday"("grupo", "produto");
