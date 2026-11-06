-- CreateEnum
CREATE TYPE "ClienteCadastroMatchConfianca" AS ENUM ('ID', 'NOME');

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "clienteCadastroId" TEXT,
ADD COLUMN     "clienteCadastroMatchConfianca" "ClienteCadastroMatchConfianca";

-- CreateIndex
CREATE INDEX "Sale_clienteCadastroId_idx" ON "Sale"("clienteCadastroId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_clienteCadastroId_fkey" FOREIGN KEY ("clienteCadastroId") REFERENCES "ClienteCadastro"("id") ON DELETE SET NULL ON UPDATE CASCADE;
