import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

export type ProductionOrderRow = {
  idOrdemProducao: number;
  cod: string;
  ordemProducao: string;
  referencia: string;
  produto: string;
  cor: string | null;
  tamanho: string | null;
  grupo: string;
  marca: string | null;
  colecao: string | null;
  quantidade: number;
  quantidadeOriginal: number;
  status: string;
  dataFinalizacaoProducao: Date | null;
  dataEntradaCelula: Date | null;
};

// Upsert em lote (INSERT ... ON CONFLICT DO UPDATE) por (idOrdemProducao, cod) — a API às vezes
// repete a mesma combinação na resposta, então dedupa antes de montar o batch (mantém a última
// ocorrência) pra não quebrar o INSERT ("cannot affect row a second time").
export async function upsertProductionOrders(
  prisma: PrismaClient,
  rows: ProductionOrderRow[],
  batchSize = 1000
): Promise<number> {
  const dedupMap = new Map<string, ProductionOrderRow>();
  for (const r of rows) dedupMap.set(`${r.idOrdemProducao}::${r.cod}`, r);
  const deduped = [...dedupMap.values()];

  let total = 0;
  for (let i = 0; i < deduped.length; i += batchSize) {
    const batch = deduped.slice(i, i + batchSize);
    const values = batch.map(
      (r) =>
        Prisma.sql`(${randomUUID()}, ${r.idOrdemProducao}, ${r.cod}, ${r.ordemProducao}, ${r.referencia}, ${r.produto}, ${r.cor}, ${r.tamanho}, ${r.grupo}, ${r.marca}, ${r.colecao}, ${r.quantidade}, ${r.quantidadeOriginal}, ${r.status}, ${r.dataFinalizacaoProducao}, ${r.dataEntradaCelula})`
    );

    await prisma.$executeRaw`
      INSERT INTO "ProductionOrder"
        ("id","idOrdemProducao","cod","ordemProducao","referencia","produto","cor","tamanho","grupo","marca","colecao","quantidade","quantidadeOriginal","status","dataFinalizacaoProducao","dataEntradaCelula")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("idOrdemProducao","cod") DO UPDATE SET
        "ordemProducao" = EXCLUDED."ordemProducao",
        "referencia" = EXCLUDED."referencia",
        "produto" = EXCLUDED."produto",
        "cor" = EXCLUDED."cor",
        "tamanho" = EXCLUDED."tamanho",
        "grupo" = EXCLUDED."grupo",
        "marca" = EXCLUDED."marca",
        "colecao" = EXCLUDED."colecao",
        "quantidade" = EXCLUDED."quantidade",
        "quantidadeOriginal" = EXCLUDED."quantidadeOriginal",
        "status" = EXCLUDED."status",
        "dataFinalizacaoProducao" = EXCLUDED."dataFinalizacaoProducao",
        "dataEntradaCelula" = EXCLUDED."dataEntradaCelula"
    `;
    total += batch.length;
  }

  return total;
}
