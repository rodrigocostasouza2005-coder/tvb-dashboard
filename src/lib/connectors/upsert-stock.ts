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
        "colecao" = EXCLUDED."colecao",
        "quantidadeDisponivel" = EXCLUDED."quantidadeDisponivel",
        "estoqueMinimo" = EXCLUDED."estoqueMinimo",
        "valorCusto" = EXCLUDED."valorCusto",
        "syncedAt" = EXCLUDED."syncedAt"
    `;
    total += batch.length;
  }

  return total;
}
