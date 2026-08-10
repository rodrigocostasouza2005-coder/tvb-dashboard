// Backfill único: remove o prefixo de referência ("CODIGO - ") do nome dos produtos já
// gravados em StockSnapshot, pra ficar igual ao nome limpo que vem das vendas. Ver
// stripReferenciaPrefix em src/lib/connectors/dapic.ts (mesmo padrão regex). Idempotente —
// rodar de novo não muda nada em linhas já limpas.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const antes = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*) as count FROM "StockSnapshot" WHERE produto ~ '^\\S+ - '`
  );
  console.log("linhas com prefixo:", antes[0].count.toString());

  const result = await prisma.$executeRawUnsafe(
    `UPDATE "StockSnapshot" SET produto = regexp_replace(produto, '^\\S+ - ', '') WHERE produto ~ '^\\S+ - '`
  );
  console.log("linhas atualizadas:", result);

  const depois = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*) as count FROM "StockSnapshot" WHERE produto ~ '^\\S+ - '`
  );
  console.log("linhas com prefixo restantes (deve ser 0):", depois[0].count.toString());
}
main().finally(() => prisma.$disconnect());
