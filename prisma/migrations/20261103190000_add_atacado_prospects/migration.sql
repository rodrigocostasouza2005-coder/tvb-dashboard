-- CreateTable
CREATE TABLE "AtacadoProspect" (
    "id" TEXT NOT NULL,
    "razaoSocial" TEXT,
    "nomeFantasia" TEXT NOT NULL,
    "cnpj" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "site" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'manual',
    "evidenciaUrl" TEXT,
    "evidenciaEm" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'NOVO',
    "responsavel" TEXT,
    "observacoes" TEXT,
    "criadoPor" TEXT,
    "convertidoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtacadoProspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtacadoProspectActivity" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "criadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AtacadoProspectActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AtacadoProspect_cnpj_key" ON "AtacadoProspect"("cnpj");

-- CreateIndex
CREATE INDEX "AtacadoProspect_estado_cidade_idx" ON "AtacadoProspect"("estado", "cidade");

-- CreateIndex
CREATE INDEX "AtacadoProspect_status_updatedAt_idx" ON "AtacadoProspect"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "AtacadoProspect_nomeFantasia_idx" ON "AtacadoProspect"("nomeFantasia");

-- CreateIndex
CREATE INDEX "AtacadoProspectActivity_prospectId_createdAt_idx" ON "AtacadoProspectActivity"("prospectId", "createdAt");

-- AddForeignKey
ALTER TABLE "AtacadoProspectActivity" ADD CONSTRAINT "AtacadoProspectActivity_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "AtacadoProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
