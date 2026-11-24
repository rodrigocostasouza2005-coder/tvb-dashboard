import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  const users = await prisma.user.findMany({
    select: { email: true, role: true, allowedTabs: true },
    orderBy: { email: "asc" },
  });
  console.log(JSON.stringify(users, null, 2));
  await prisma.$disconnect();
})();
