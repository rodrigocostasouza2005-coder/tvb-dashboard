import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

export type StockSnapshotRow = {
  storeId: string;
  cod: string;
  produto: string;
  grupo: string;
  cor: string | null;
  tamanho: string | null;
  colecao: string | null;
  quantidadeDisponivel: number;
  estoqueMinimo: number | null;
  valorCusto: number | null;
};

// Upsert em lote (INSERT ... ON CONFLICT DO UPDATE) em vez de createMany — mantém 1 linha por
// storeId+cod, atualizada a cada sync, em vez de acumular uma linha nova por rodada pra sempre.
// Usa SQL bruto porque um upsert por linha (28k+ round-trips por sync) seria lento demais.
export async function upsertStockSnapshots(
  prisma: PrismaClient,
  rows: StockSnapshotRow[],
  batchSize = 1000
): Promise<number> {
  const syncedAt = new Date();
  let total = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = batch.map(
      (r) =>
        Prisma.sql`(${randomUUID()}, ${r.storeId}, ${r.cod}, ${r.produto}, ${r.grupo}, ${r.cor}, ${r.tamanho}, ${r.colecao}, ${r.quantidadeDisponivel}, ${r.estoqueMinimo}, ${r.valorCusto}, ${syncedAt})`
    );

    await prisma.$executeRaw`
      INSERT INTO "StockSnapshot"
        ("id", "storeId", "cod", "produto", "grupo", "cor", "tamanho", "colecao", "quantidadeDisponivel", "estoqueMinimo", "valorCusto", "syncedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("storeId", "cod") DO UPDATE SET
        "produto" = EXCLUDED."produto",
        "grupo" = EXCLUDED."grupo",
        "cor" = EXCLUDED."cor",
        "tamanho" = EXCLUDED."tamanho",
        -- COALESCE: o DAPIC às vezes manda Colecao vazio pra um produto que já tinha coleção
        -- preenchida num sync anterior (achado com as Garrafas em 2026-09-28) — preferir manter
        -- a coleção que já sabíamos em vez de apagar. Só sobrescreve quando o novo valor É algo.
        "colecao" = COALESCE(EXCLUDED."colecao", "StockSnapshot"."colecao"),
        "quantidadeDisponivel" = EXCLUDED."quantidadeDisponivel",
        "estoqueMinimo" = EXCLUDED."estoqueMinimo",
        "valorCusto" = EXCLUDED."valorCusto",
        "syncedAt" = EXCLUDED."syncedAt"
    `;
    total += batch.length;
  }

  return total;
}

// Histórico diário real de estoque (StockSnapshotDiario, pedido do Rodrigo em 2026-11-19) — ver
// comentário do model no schema.prisma pro porquê de existir ao lado de StockSnapshot (que só
// guarda o valor ATUAL, sem série no tempo). Mesma técnica de upsert em lote da função acima
// (reusa as MESMAS rows já buscadas no DAPIC por syncEstoque — nenhuma chamada extra à API), só
// com storeId+cod+data como chave de conflito em vez de storeId+cod: isso é o que faz o cron
// rodando várias vezes ao dia (vercel.json) gravar 1 linha por dia só, atualizada a cada rodada,
// em vez de acumular uma linha nova por sync.
export async function upsertStockSnapshotsDiario(
  prisma: PrismaClient,
  rows: StockSnapshotRow[],
  data: Date,
  batchSize = 1000
): Promise<number> {
  const syncedAt = new Date();
  let total = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = batch.map(
      (r) =>
        Prisma.sql`(${randomUUID()}, ${r.storeId}, ${r.cod}, ${r.produto}, ${r.grupo}, ${r.cor}, ${r.tamanho}, ${r.colecao}, ${r.quantidadeDisponivel}, ${r.valorCusto}, ${data}, ${syncedAt})`
    );

    await prisma.$executeRaw`
      INSERT INTO "StockSnapshotDiario"
        ("id", "storeId", "cod", "produto", "grupo", "cor", "tamanho", "colecao", "quantidadeDisponivel", "valorCusto", "data", "syncedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("storeId", "cod", "data") DO UPDATE SET
        "produto" = EXCLUDED."produto",
        "grupo" = EXCLUDED."grupo",
        "cor" = EXCLUDED."cor",
        "tamanho" = EXCLUDED."tamanho",
        "colecao" = COALESCE(EXCLUDED."colecao", "StockSnapshotDiario"."colecao"),
        "quantidadeDisponivel" = EXCLUDED."quantidadeDisponivel",
        "valorCusto" = EXCLUDED."valorCusto",
        "syncedAt" = EXCLUDED."syncedAt"
    `;
    total += batch.length;
  }

  return total;
}
