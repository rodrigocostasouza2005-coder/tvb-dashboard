-- Reverte a migration 20261123160000_raise_grao_classificacao_produto_cor, que aplicou no banco
-- (dev e produção) a mudança de grão de ClassificacaoProduto de `cod` pra `produto+cor`, mas cujo
-- código nunca chegou a ser mergeado no main (branch feat/classificacao-grao-produto-cor-20261119
-- ficou parada em merge com conflito não resolvido). Resultado: banco em produção ficou num
-- formato que o código deployado (main) não entende — toda consulta a
-- prisma.classificacaoProduto.findMany() com `cod` quebrava com P2022 ("column does not exist"),
-- derrubando a aba Reposição e qualquer outra tela que cruza com Mapa de Compras/Distribuição.
--
-- Seguro de rodar sem perda de dado: confirmado com o Rodrigo (2026-11-25) que ninguém classificou
-- nenhum produto pelo painel desde 23/11 — a tabela está vazia (0 linhas) tanto em dev quanto em
-- produção (a própria migration original só conseguiu aplicar DROP COLUMN "cod" NOT NULL -> ADD
-- COLUMN "cor"/"produtoCor" NOT NULL sem default porque a tabela já estava vazia; não teria
-- passado em uma tabela com dado real).

-- DropIndex
DROP INDEX "ClassificacaoProduto_produtoCor_key";
DROP INDEX "ClassificacaoProduto_produto_idx";

-- AlterTable
ALTER TABLE "ClassificacaoProduto" DROP COLUMN "cor",
DROP COLUMN "produtoCor",
ADD COLUMN     "cod" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ClassificacaoProduto_cod_key" ON "ClassificacaoProduto"("cod");
