-- Structured fields from official Serpro/Receita Federal CNPJ consultation.
-- Additive and safe for existing prospect records.
ALTER TABLE "AtacadoProspect"
  ADD COLUMN IF NOT EXISTS "situacaoCadastral" TEXT,
  ADD COLUMN IF NOT EXISTS "situacaoCadastralCodigo" TEXT,
  ADD COLUMN IF NOT EXISTS "situacaoCadastralData" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cnaePrincipalCodigo" TEXT,
  ADD COLUMN IF NOT EXISTS "cnaePrincipalDescricao" TEXT,
  ADD COLUMN IF NOT EXISTS "cnaesSecundarios" TEXT,
  ADD COLUMN IF NOT EXISTS "enderecoOficial" TEXT,
  ADD COLUMN IF NOT EXISTS "cepOficial" TEXT,
  ADD COLUMN IF NOT EXISTS "porteEmpresa" TEXT,
  ADD COLUMN IF NOT EXISTS "dataAbertura" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "AtacadoProspect_situacaoCadastral_idx"
  ON "AtacadoProspect"("situacaoCadastral");
