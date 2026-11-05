-- AlterEnum
-- Missão Black Friday (2026-11): Meta Ads e GA4 não tinham SyncSource próprio em SyncLog — sem
-- jeito de registrar sucesso/erro da última busca real desses dois conectores (ver comentário em
-- schema.prisma, enum SyncSource, e getSyncStatusDetalhado em src/lib/sync-runner.ts). Puramente
-- aditivo (só adiciona valores novos ao enum existente, nenhuma tabela/coluna muda) — seguro pra
-- aplicar em produção sem backfill nem downtime.
ALTER TYPE "SyncSource" ADD VALUE 'META_ADS';
ALTER TYPE "SyncSource" ADD VALUE 'GA4';
