-- Add structured research and commercial qualification fields.
ALTER TABLE "AtacadoProspect"
  ADD COLUMN "codigoMunicipio" TEXT,
  ADD COLUMN "instagram" TEXT,
  ADD COLUMN "grupoComercial" TEXT NOT NULL DEFAULT 'PENDENTE',
  ADD COLUMN "scoreComercial" INTEGER,
  ADD COLUMN "justificativaGrupo" TEXT,
  ADD COLUMN "confiancaPesquisa" TEXT,
  ADD COLUMN "nomeComercialVerificado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pesquisadoEm" TIMESTAMP(3);

CREATE INDEX "AtacadoProspect_grupoComercial_estado_cidade_idx"
  ON "AtacadoProspect"("grupoComercial", "estado", "cidade");
