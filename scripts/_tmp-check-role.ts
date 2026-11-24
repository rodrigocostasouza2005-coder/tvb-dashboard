import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  const user = await prisma.user.findUnique({
    where: { email: "rodrigoximbe2005@gmail.com" },
    select: { email: true, role: true, allowedTabs: true },
  });
  console.log(JSON.stringify(user, null, 2));
  await prisma.$disconnect();
})();
