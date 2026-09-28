// Correção retroativa única (pedido do Rodrigo, 2026-09-28): "Garrafa 1200 ml [Cor]" é sempre
// brinde registrado como "Venda" no DAPIC por questão tributária, nunca cobrado de verdade — o
// valor não devia contar como receita em nenhuma métrica. Zera valorTotalLiquido das vendas já
// sincronizadas (mantém a linha, só zera o valor — unidades/contagem continuam intactas).
// Uso: npx tsx scripts/backfill-zera-garrafa.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const antes = await prisma.sale.aggregate({
    where: { produto: { startsWith: "Garrafa" }, valorTotalLiquido: { not: 0 } },
    _sum: { valorTotalLiquido: true },
    _count: true,
  });
  console.log(`Antes: ${antes._count} vendas de Garrafa com valor > 0, somando R$ ${antes._sum.valorTotalLiquido?.toFixed(2)}`);

  const r = await prisma.sale.updateMany({
    where: { produto: { startsWith: "Garrafa" }, valorTotalLiquido: { not: 0 } },
    data: { valorTotalLiquido: 0 },
  });
  console.log(`Zeradas: ${r.count} linhas.`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); prisma.$disconnect(); });
