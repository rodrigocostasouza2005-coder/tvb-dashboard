-- Registro persistente de armazéns já vistos no DAPIC, keyed por (clientLabel, dapicArmazenadorId)
-- em vez do nome — corrige o alerta "armazém novo" repetitivo (ver ArmazemConhecido em schema.prisma).
CREATE TABLE "ArmazemConhecido" (
    "id" TEXT NOT NULL,
    "clientLabel" TEXT NOT NULL,
    "dapicArmazenadorId" INTEGER NOT NULL,
    "nomeAtual" TEXT NOT NULL,
    "classificacao" TEXT NOT NULL,
    "primeiraVezVistoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArmazemConhecido_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArmazemConhecido_clientLabel_dapicArmazenadorId_key" ON "ArmazemConhecido"("clientLabel", "dapicArmazenadorId");
