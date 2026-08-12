import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const directUrl = process.env.DATABASE_URL?.replace("-pooler.", ".");
const prisma = new PrismaClient(directUrl ? { datasourceUrl: directUrl } : undefined);

async function main() {
  const since = new Date("2026-08-12T14:44:45.000Z");
  const logs = await prisma.syncLog.findMany({
    where: { startedAt: { gte: since } },
    orderBy: { startedAt: "asc" },
  });
  for (const l of logs) console.log(l.source, l.status, "records=" + l.recordsSynced, l.startedAt.toISOString());
  console.log("HAS_GIFTS=" + logs.some((l) => l.source === "GIFTS"));
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
