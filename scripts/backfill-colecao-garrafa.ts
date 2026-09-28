import { prisma } from "../src/lib/prisma";

// Garrafas ficaram sem colecao (StockSnapshot e Sale) porque o DAPIC retorna Colecao: null pra
// esses 3 produtos em algumas rotas — mas outras linhas do MESMO produto já têm "Verão 27"
// preenchido, então dá pra inferir com segurança. Achado do Rodrigo em 2026-09-28.
async function main() {
  const stock = await prisma.stockSnapshot.updateMany({
    where: { produto: { startsWith: "Garrafa" }, colecao: null },
    data: { colecao: "Verão 27" },
  });
  const sale = await prisma.sale.updateMany({
    where: { produto: { startsWith: "Garrafa" }, colecao: null },
    data: { colecao: "Verão 27" },
  });
  console.log(`StockSnapshot atualizado: ${stock.count} linhas`);
  console.log(`Sale atualizado: ${sale.count} linhas`);
  await prisma.$disconnect();
}

main();
