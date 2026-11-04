-- Add structured research and commercial qualification fields.
-- Idempotent because the initial production rollout used an additive SQL patch
-- before Prisma migration history was reconciled.
ALTER TABLE "AtacadoProspect"
  ADD COLUMN IF NOT EXISTS "codigoMunicipio" TEXT,
  ADD COLUMN IF NOT EXISTS "instagram" TEXT,
  ADD COLUMN IF NOT EXISTS "grupoComercial" TEXT NOT NULL DEFAULT 'PENDENTE',
  ADD COLUMN IF NOT EXISTS "scoreComercial" INTEGER,
  ADD COLUMN IF NOT EXISTS "justificativaGrupo" TEXT,
  ADD COLUMN IF NOT EXISTS "confiancaPesquisa" TEXT,
  ADD COLUMN IF NOT EXISTS "nomeComercialVerificado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "pesquisadoEm" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "AtacadoProspect_grupoComercial_estado_cidade_idx"
  ON "AtacadoProspect"("grupoComercial", "estado", "cidade");
