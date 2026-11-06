-- Rebuild do núcleo de qualificação B2B (Fase 1, 2026-11) — ver src/lib/prospeccao/motor-qualificacao.ts.
-- Migration gerada manualmente a partir de `prisma migrate diff --from-url ... --to-schema-datamodel
-- prisma/schema.prisma --script`, e então PODADA a mão: o diff bruto também incluía DROP de índices
-- e DROP TABLE "BlackFridayBannerConfig" que pertencem a drift de OUTRO branch ativo (não mergeado)
-- no mesmo banco de dev compartilhado — nada disso faz parte desta mudança e não deve ser aplicado
-- por esta migration. Só o que é efetivamente aditivo para o núcleo de qualificação está abaixo.

-- CreateEnum
CREATE TYPE "ClassificacaoProspectComercial" AS ENUM ('ALTA_PRIORIDADE', 'QUALIFICADO', 'REPROVADO');

-- CreateEnum
CREATE TYPE "StatusComercialProspect" AS ENUM ('APROVADO', 'EM_INVESTIGACAO', 'REPROVADO', 'PENDENTE_REVISAO_HUMANA');

-- CreateEnum
CREATE TYPE "ResultadoGateEliminacao" AS ENUM ('APROVADO_GATE', 'REPROVADO', 'INCONCLUSIVO');

-- CreateEnum
CREATE TYPE "TipoEstabelecimentoProspect" AS ENUM ('MATRIZ', 'FILIAL');

-- CreateEnum
CREATE TYPE "TipoEvidenciaMarca" AS ENUM ('SITE_OFICIAL', 'CATALOGO_PRODUTO', 'INSTAGRAM_COMERCIAL', 'POST_PRODUTO', 'FOTO_VITRINE', 'MARKETPLACE', 'OUTRA_FONTE_VERIFICAVEL');

-- CreateEnum
CREATE TYPE "NivelConfiancaProspect" AS ENUM ('ALTA', 'MEDIA', 'BAIXA');

-- AlterTable
ALTER TABLE "AtacadoProspect" ADD COLUMN     "capitalEstadual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "classificacaoProspect" "ClassificacaoProspectComercial",
ADD COLUMN     "cnpjRaiz" TEXT,
ADD COLUMN     "enderecoNormalizado" TEXT,
ADD COLUMN     "evidenciasQualificacao" JSONB,
ADD COLUMN     "motivosEliminacao" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "nomeFantasiaNormalizado" TEXT,
ADD COLUMN     "resultadoEliminacao" "ResultadoGateEliminacao",
ADD COLUMN     "revisaoAdversarialEm" TIMESTAMP(3),
ADD COLUMN     "revisaoAdversarialPor" TEXT,
ADD COLUMN     "revisaoAdversarialStatus" TEXT,
ADD COLUMN     "scoreDetalhe" JSONB,
ADD COLUMN     "statusComercial" "StatusComercialProspect" NOT NULL DEFAULT 'EM_INVESTIGACAO',
ADD COLUMN     "tipoEstabelecimento" "TipoEstabelecimentoProspect",
ADD COLUMN     "ultimaValidacaoEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AtacadoProspectBrand" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "marcaNormalizada" TEXT NOT NULL,
    "evidencia" TEXT NOT NULL,
    "fonteUrl" TEXT NOT NULL,
    "dataVerificacao" TIMESTAMP(3) NOT NULL,
    "tipoEvidencia" "TipoEvidenciaMarca" NOT NULL,
    "confianca" "NivelConfiancaProspect" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AtacadoProspectBrand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AtacadoProspectBrand_prospectId_idx" ON "AtacadoProspectBrand"("prospectId");

-- CreateIndex
CREATE UNIQUE INDEX "AtacadoProspectBrand_prospectId_marcaNormalizada_key" ON "AtacadoProspectBrand"("prospectId", "marcaNormalizada");

-- CreateIndex
CREATE INDEX "AtacadoProspect_cnpjRaiz_idx" ON "AtacadoProspect"("cnpjRaiz");

-- CreateIndex
CREATE INDEX "AtacadoProspect_statusComercial_idx" ON "AtacadoProspect"("statusComercial");

-- CreateIndex
CREATE INDEX "AtacadoProspect_classificacaoProspect_idx" ON "AtacadoProspect"("classificacaoProspect");

-- CreateIndex
CREATE INDEX "AtacadoProspect_nomeFantasiaNormalizado_idx" ON "AtacadoProspect"("nomeFantasiaNormalizado");

-- AddForeignKey
ALTER TABLE "AtacadoProspectBrand" ADD CONSTRAINT "AtacadoProspectBrand_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "AtacadoProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
