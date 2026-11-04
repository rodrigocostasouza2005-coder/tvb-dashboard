-- Structured commercial outcomes and store-profile attributes for the TVB prospecting feedback loop.
-- Idempotent so environments with a partially applied SQL patch can reconcile safely.
ALTER TABLE "AtacadoProspect"
  ADD COLUMN IF NOT EXISTS "segmentoComercial" TEXT,
  ADD COLUMN IF NOT EXISTS "perfilLoja" TEXT,
  ADD COLUMN IF NOT EXISTS "faixaPreco" TEXT,
  ADD COLUMN IF NOT EXISTS "origemAgente" TEXT;

ALTER TABLE "AtacadoProspectActivity"
  ADD COLUMN IF NOT EXISTS "resultado" TEXT,
  ADD COLUMN IF NOT EXISTS "canal" TEXT,
  ADD COLUMN IF NOT EXISTS "etapa" TEXT;

CREATE INDEX IF NOT EXISTS "AtacadoProspectActivity_resultado_createdAt_idx"
  ON "AtacadoProspectActivity"("resultado", "createdAt");
CREATE INDEX IF NOT EXISTS "AtacadoProspect_segmentoComercial_perfilLoja_idx"
  ON "AtacadoProspect"("segmentoComercial", "perfilLoja");
