-- CreateTable
CREATE TABLE "MetaDiariaBlackFriday" (
    "id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "metaReceita2026" DOUBLE PRECISION NOT NULL,
    "receitaReal2025" DOUBLE PRECISION,
    "acao" TEXT,
    "canais" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaDiariaBlackFriday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetaDiariaBlackFriday_data_key" ON "MetaDiariaBlackFriday"("data");
