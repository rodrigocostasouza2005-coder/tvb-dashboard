-- Raise grão de ClassificacaoProduto de `cod` (produto+cor+tamanho) pra produto+cor (pedido do
-- Rodrigo, 2026-11-19/23). Ver comentário completo em prisma/schema.prisma no model
-- ClassificacaoProduto.
--
-- ATENÇÃO — ORDEM DE APLICAÇÃO EM AMBIENTE COM DADO EXISTENTE (produção): esta migration só é
-- segura rodar DEPOIS que o script scripts/migrar-classificacao-produto-cor.ts tiver consolidado
-- as linhas existentes (1 por cod) em 1 por produto+cor, resolvendo conflitos. Rodada direto
-- contra uma tabela com dado no formato antigo, ela falha (ADD COLUMN "cor" TEXT NOT NULL sem
-- default não é permitido em tabela não-vazia) — falha segura (a transação inteira é revertida,
-- Postgres nunca aplica DDL parcial), nunca corrompe dado, mas também não resolve nada sozinha.
-- No Neon dev (ambiente desta migration) a tabela estava com 0 linhas, então aplicou direto sem
-- precisar do script.

-- DropIndex
DROP INDEX "ClassificacaoProduto_cod_key";

-- AlterTable
ALTER TABLE "ClassificacaoProduto" DROP COLUMN "cod",
ADD COLUMN     "cor" TEXT NOT NULL,
ADD COLUMN     "produtoCor" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ClassificacaoProduto_produtoCor_key" ON "ClassificacaoProduto"("produtoCor");

-- CreateIndex
CREATE INDEX "ClassificacaoProduto_produto_idx" ON "ClassificacaoProduto"("produto");
