// Backfill único do cadastro de clientes via /clientes.
// Idempotente (upsert por dapicId) — pode ser rodado de novo sem duplicar nada.
// Uso: npx tsx scripts/backfill-clientes.ts

import { PrismaClient } from "@prisma/client";
import { createDapicClients } from "../src/lib/connectors/dapic";

const directUrl = process.env.DATABASE_URL?.replace("-pooler.", ".");
const prisma = new PrismaClient(directUrl ? { datasourceUrl: directUrl } : undefined);

// Range amplo pra pegar todos os cadastros históricos.
const DATA_INICIAL = "2020-01-01";
const DATA_FINAL = new Date().toISOString().slice(0, 10);

async function main() {
  // 1 token basta — cd-atacado enxerga todos os clientes da empresa
  const clients = createDapicClients();
  const cdClient = clients.find((c) => c.label === "cd-atacado") ?? clients[0];

  console.log(`Buscando clientes de ${DATA_INICIAL} até ${DATA_FINAL}...`);
  const clientes = await cdClient.fetchClientes(DATA_INICIAL, DATA_FINAL);
  console.log(`Recebidos: ${clientes.length} clientes`);

  let upserted = 0;
  for (const c of clientes) {
    await prisma.clienteCadastro.upsert({
      where: { dapicId: c.Id },
      update: {
        nome: c.NomeRazaoSocial,
        telefone: c.Telefone ?? null,
        celular: c.Celular ?? null,
        email: c.Email ?? null,
      },
      create: {
        dapicId: c.Id,
        nome: c.NomeRazaoSocial,
        telefone: c.Telefone ?? null,
        celular: c.Celular ?? null,
        email: c.Email ?? null,
      },
    });
    upserted++;
  }

  console.log(`✓ ${upserted} clientes gravados no banco.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
