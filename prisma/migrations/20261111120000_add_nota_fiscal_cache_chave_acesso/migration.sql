-- Aditiva: 3 colunas nullable novas em NotaFiscalCache (chaveAcesso, numeroSerie, tipo).
-- Não altera nem remove "numero" (contrato existente, usado por getNumeroNotaFiscal) nem a
-- constraint @@unique([storeId, dapicVendaId]) já existente. Ver schema.prisma pro contexto
-- completo (feature de Notas Fiscais da Ficha do Cliente, 2026-11-11).
ALTER TABLE "NotaFiscalCache" ADD COLUMN     "chaveAcesso" TEXT;
ALTER TABLE "NotaFiscalCache" ADD COLUMN     "numeroSerie" INTEGER;
ALTER TABLE "NotaFiscalCache" ADD COLUMN     "tipo" TEXT;
