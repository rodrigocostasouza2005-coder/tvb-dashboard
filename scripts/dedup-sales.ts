import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function run() {
  console.log("Running deduplication...");
  const count = await prisma.$executeRaw`
    DELETE FROM "Sale" s1
    WHERE s1."itemIndex" < 10
    AND EXISTS (
      SELECT 1 FROM "Sale" s2
      WHERE s2."storeId" = s1."storeId"
        AND s2."dapicVendaId" = s1."dapicVendaId"
        AND s2."itemIndex" >= 1000
    )
  `;
  console.log("Deleted rows:", count);

  // Verify: check a vendedor total
  const result = await prisma.$queryRaw<{ pessoa: string; total: number }[]>`
    SELECT v."dapicNome" as pessoa, ROUND(SUM(s."valorLiquido")::numeric, 2) as total
    FROM "Sale" s
    JOIN "Vendedor" v ON v.id = s."vendedorId"
    WHERE s."saleDate" >= '2026-08-01'
      AND s."saleDate" < '2026-08-21'
    GROUP BY v."dapicNome"
    ORDER BY total DESC
    LIMIT 5
  `;
  console.log("Top vendedores 1-20/8:", result);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
