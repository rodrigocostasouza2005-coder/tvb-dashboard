// Gera dados fictícios pra Devolução e Produção (o arquivo real de devolução é grande
// demais / lento demais pra valer a pena agora — Rodrigo topou usar fictício aqui).
// Vendas e Estoque continuam com os dados reais já importados.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(daysAgoMax: number) {
  const d = new Date();
  d.setDate(d.getDate() - randomInt(0, daysAgoMax));
  return d;
}

async function main() {
  // Usa combinações reais de grupo/produto/cor/tamanho já existentes nas vendas,
  // pra ficar consistente com o resto do dashboard.
  const sampleSales = await prisma.sale.findMany({
    take: 500,
    select: { storeId: true, cod: true, produto: true, grupo: true, cor: true, tamanho: true, valorTotalLiquido: true, quantidade: true },
  });

  if (sampleSales.length === 0) {
    console.log("Nenhuma venda encontrada pra basear os dados fictícios — rode a importação de vendas antes.");
    process.exit(1);
  }

  await prisma.return.deleteMany({});
  await prisma.productionOrder.deleteMany({});

  const returns = [];
  for (let i = 0; i < 300; i++) {
    const s = sampleSales[randomInt(0, sampleSales.length - 1)];
    const qty = randomInt(1, Math.max(1, Math.min(3, s.quantidade)));
    const unitValue = s.quantidade > 0 ? s.valorTotalLiquido / s.quantidade : 0;
    returns.push({
      storeId: s.storeId,
      cod: s.cod,
      produto: s.produto,
      grupo: s.grupo,
      cor: s.cor,
      tamanho: s.tamanho,
      quantidade: qty,
      valorTotal: Math.round(unitValue * qty * 100) / 100,
      returnDate: randomDate(60),
    });
  }
  await prisma.return.createMany({ data: returns });
  console.log(`Devoluções fictícias: ${returns.length} criadas.`);

  const grupos = [...new Set(sampleSales.map((s) => s.grupo))];
  const production = [];
  for (let i = 0; i < 150; i++) {
    const grupo = grupos[randomInt(0, grupos.length - 1)];
    const s = sampleSales.find((x) => x.grupo === grupo)!;
    production.push({
      grupo,
      referencia: s.cod.split(" ")[0] ?? null,
      produto: s.produto,
      tamanho: s.tamanho,
      quantidadeFinalizada: randomInt(10, 200),
      dataPrevisao: Math.random() < 0.7 ? randomDate(30) : null,
      ordemProducao: `OP-FICT-${1000 + i}`,
      cod: s.cod,
    });
  }
  await prisma.productionOrder.createMany({ data: production });
  console.log(`Ordens de produção fictícias: ${production.length} criadas.`);

  await prisma.syncLog.createMany({
    data: [
      { source: "RETURNS", status: "SUCCESS", recordsSynced: returns.length, message: "Dados fictícios (arquivo real muito lento por ora)", finishedAt: new Date() },
      { source: "PRODUCTION", status: "SUCCESS", recordsSynced: production.length, message: "Dados fictícios (arquivo real muito lento por ora)", finishedAt: new Date() },
    ],
  });

  console.log("Concluído.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
