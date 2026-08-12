// Migração única: antes de 2026-08-12, "vazio" em allowedStores/allowedMarcas/allowedTabelasPreco
// significava "sem restrição, vê tudo". Rodrigo pediu pra inverter (vazio = não libera nada,
// default-deny) — pra ninguém que já tinha acesso perder, marca explicitamente TODAS as opções
// pra todo usuário que já existe. Só usuário novo (ou editado de propósito, desmarcando tudo)
// fica sem nada liberado a partir de agora.
// Idempotente: só preenche quem ainda está com array vazio (não sobrescreve quem já foi editado
// manualmente). Uso: npx tsx scripts/migrate-explicit-allowlists.ts
import { PrismaClient } from "@prisma/client";

const directUrl = process.env.DATABASE_URL?.replace("-pooler.", ".");
const prisma = new PrismaClient(directUrl ? { datasourceUrl: directUrl } : undefined);

async function main() {
  const [stores, marcaRows, tabelaRows, users] = await Promise.all([
    prisma.store.findMany({ select: { id: true } }),
    prisma.sale.findMany({ distinct: ["marca"], select: { marca: true }, where: { marca: { not: null } } }),
    prisma.sale.findMany({
      distinct: ["tabelaPreco"],
      select: { tabelaPreco: true },
      where: { tabelaPreco: { not: null } },
    }),
    prisma.user.findMany(),
  ]);

  const allStoreIds = stores.map((s) => s.id);
  const allMarcas = marcaRows.map((r) => r.marca as string);
  const allTabelasPreco = tabelaRows.map((r) => r.tabelaPreco as string);

  console.log(`${allStoreIds.length} lojas, ${allMarcas.length} marcas, ${allTabelasPreco.length} tabelas de preço.`);
  console.log(`${users.length} usuários encontrados.`);

  let atualizados = 0;
  for (const u of users) {
    const data: { allowedStores?: string[]; allowedMarcas?: string[]; allowedTabelasPreco?: string[] } = {};
    if (u.allowedStores.length === 0) data.allowedStores = allStoreIds;
    if (u.allowedMarcas.length === 0) data.allowedMarcas = allMarcas;
    if (u.allowedTabelasPreco.length === 0) data.allowedTabelasPreco = allTabelasPreco;

    if (Object.keys(data).length === 0) {
      console.log(`  ${u.email}: já tinha algo marcado em algum campo, pulando.`);
      continue;
    }

    await prisma.user.update({ where: { id: u.id }, data });
    console.log(`  ${u.email}: migrado (${Object.keys(data).join(", ")}).`);
    atualizados++;
  }

  console.log(`\n${atualizados} usuários migrados.`);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
