-- Structured commercial outcomes and store-profile attributes for the TVB prospecting feedback loop.
ALTER TABLE "AtacadoProspect"
  ADD COLUMN "segmentoComercial" TEXT,
  ADD COLUMN "perfilLoja" TEXT,
  ADD COLUMN "faixaPreco" TEXT,
  ADD COLUMN "origemAgente" TEXT;

ALTER TABLE "AtacadoProspectActivity"
  ADD COLUMN "resultado" TEXT,
  ADD COLUMN "canal" TEXT,
  ADD COLUMN "etapa" TEXT;

CREATE INDEX "AtacadoProspectActivity_resultado_createdAt_idx"
  ON "AtacadoProspectActivity"("resultado", "createdAt");
CREATE INDEX "AtacadoProspect_segmentoComercial_perfilLoja_idx"
  ON "AtacadoProspect"("segmentoComercial", "perfilLoja");
