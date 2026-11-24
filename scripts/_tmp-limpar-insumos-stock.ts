import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Limpeza pontual (2026-11-24, pedido do Rodrigo: "não quero que matéria prima tenha no radar").
// syncEstoque já foi corrigido (sync-runner.ts) pra nunca mais gravar essas linhas — este script
// remove as que já foram gravadas ANTES da correção. Escopo bem restrito de propósito: só
// StockSnapshot/StockSnapshotDiario com grupo = "(sem grupo)" literal (nunca um DELETE genérico
// sem filtro) — confirmado antes (investigação de 2026-11-24) que são 100% insumo de produção
// (ilhós, zíper, tecido, embalagem), nunca produto acabado de verdade.
const APLICAR = process.argv.includes("--apply");

(async () => {
  const stockSnapshot = await prisma.stockSnapshot.findMany({
    where: { grupo: "(sem grupo)" },
    select: { id: true, cod: true, produto: true, storeId: true },
  });
  const stockSnapshotDiario = await prisma.stockSnapshotDiario.findMany({
    where: { grupo: "(sem grupo)" },
    select: { id: true, cod: true, produto: true, storeId: true, data: true },
  });

  console.log(`Modo: ${APLICAR ? "APLICAR (vai escrever)" : "DRY RUN (só leitura)"}`);
  console.log(`StockSnapshot com grupo="(sem grupo)": ${stockSnapshot.length} linhas`);
  console.log(`StockSnapshotDiario com grupo="(sem grupo)": ${stockSnapshotDiario.length} linhas`);

  const codsDistintos = new Set([...stockSnapshot.map((s) => s.cod), ...stockSnapshotDiario.map((s) => s.cod)]);
  console.log(`Cods distintos envolvidos: ${codsDistintos.size}`);
  console.log(`  ${[...codsDistintos].join(", ")}`);

  if (!APLICAR) {
    console.log("\nDRY RUN concluído — nada foi apagado. Rode com --apply pra remover de verdade.");
    await prisma.$disconnect();
    return;
  }

  const delSnapshot = await prisma.stockSnapshot.deleteMany({ where: { grupo: "(sem grupo)" } });
  const delDiario = await prisma.stockSnapshotDiario.deleteMany({ where: { grupo: "(sem grupo)" } });
  console.log(`\nREMOVIDO: ${delSnapshot.count} linhas de StockSnapshot, ${delDiario.count} linhas de StockSnapshotDiario`);

  await prisma.$disconnect();
})();
