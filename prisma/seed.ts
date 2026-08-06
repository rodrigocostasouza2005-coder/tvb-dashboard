import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Códigos batem com a coluna "Armazenador" dos exports do DAPIC (ver FILIAIS_BI.xlsx).
const STORES = [
  { code: "matriz", name: "Matriz", sellsProducts: false },
  { code: "CD", name: "TVB Site e Atacado", sellsProducts: true },
  { code: "Barra", name: "TVB Barra", sellsProducts: true },
  { code: "Leblon", name: "TVB Leblon", sellsProducts: true },
  { code: "Rio Sul", name: "TVB Rio Sul", sellsProducts: true },
];

// Ponto de partida para "produtos prioritários" (vendedor só vê estes grupos).
// Sem UI de admin ainda — ajustar aqui ou direto no banco por enquanto.
const PRIORITY_GROUPS = ["Classic Lisa", "Ultra Light", "Classic Blend", "Camisetas", "Boné"];

async function main() {
  for (const s of STORES) {
    await prisma.store.upsert({ where: { code: s.code }, update: s, create: s });
  }

  for (const grupo of PRIORITY_GROUPS) {
    await prisma.priorityGroup.upsert({ where: { grupo }, update: {}, create: { grupo } });
  }

  const usersSeed = [
    { name: "Rodrigo (Admin)", email: "rodrigo@tvbshorts.com", role: "ADMIN" as const },
    { name: "Gestão TVB", email: "gestao@tvbshorts.com", role: "GESTAO" as const },
    { name: "Vendedor Site", email: "vendedor@tvbshorts.com", role: "VENDEDOR" as const },
  ];
  const devPassword = await bcrypt.hash("trocar123", 10);
  for (const u of usersSeed) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role },
      create: { ...u, passwordHash: devPassword },
    });
  }

  console.log("Seed base concluído (lojas, usuários, grupos prioritários).");
  console.log("Rode `npm run db:import-real` para carregar o histórico real de vendas/estoque.");
  console.log("Usuários de teste (senha: trocar123):");
  for (const u of usersSeed) console.log(`  - ${u.email} (${u.role})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
