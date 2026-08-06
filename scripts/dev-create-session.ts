import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2] ?? "rodrigo@tvbshorts.com";
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const session = await prisma.session.create({
    data: { userId: user.id, expiresAt: new Date(Date.now() + 1000 * 60 * 60) },
  });
  console.log(session.id);
}

main().finally(() => prisma.$disconnect());
