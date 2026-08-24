// Backfill único do cadastro de clientes via /clientes.
// Idempotente (upsert em lote por dapicId) — pode ser rodado de novo sem duplicar nada.
// Uso: npx tsx scripts/backfill-clientes.ts

import { PrismaClient, Prisma } from "@prisma/client";
import { createDapicClients } from "../src/lib/connectors/dapic";
import { randomUUID } from "crypto";

const directUrl = process.env.DATABASE_URL?.replace("-pooler.", ".");
const prisma = new PrismaClient(directUrl ? { datasourceUrl: directUrl } : undefined);

const DATA_INICIAL = "2020-01-01";
const DATA_FINAL = new Date().toISOString().slice(0, 10);
const BATCH_SIZE = 500;

async function main() {
  // 1 token basta — cd-atacado enxerga todos os clientes da empresa
  const clients = createDapicClients();
  const cdClient = clients.find((c) => c.label === "cd-atacado") ?? clients[0];

  console.log(`Buscando clientes de ${DATA_INICIAL} até ${DATA_FINAL}...`);
  const clientes = await cdClient.fetchClientes(DATA_INICIAL, DATA_FINAL);
  console.log(`Recebidos: ${clientes.length} clientes`);

  let total = 0;
  for (let i = 0; i < clientes.length; i += BATCH_SIZE) {
    const batch = clientes.slice(i, i + BATCH_SIZE);
    const values = batch.map(
      (c) =>
        Prisma.sql`(${randomUUID()}, ${c.Id}, ${c.NomeRazaoSocial}, ${c.Telefone ?? null}, ${c.Celular ?? null}, ${c.Email ?? null}, ${c.DataAniversario ? new Date(c.DataAniversario) : null})`
    );

    await prisma.$executeRaw`
      INSERT INTO "ClienteCadastro" ("id", "dapicId", "nome", "telefone", "celular", "email", "dataNascimento")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("dapicId") DO UPDATE SET
        "nome"           = EXCLUDED."nome",
        "telefone"       = EXCLUDED."telefone",
        "celular"        = EXCLUDED."celular",
        "email"          = EXCLUDED."email",
        "dataNascimento" = EXCLUDED."dataNascimento"
    `;
    total += batch.length;
    process.stdout.write(`\r  ${total}/${clientes.length} inseridos...`);
  }

  console.log(`\n✓ ${total} clientes gravados no banco.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
