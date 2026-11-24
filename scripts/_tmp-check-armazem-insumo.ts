import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// So leitura. Achado: syncEstoque grava estoque de QUALQUER armazenador conhecido (sem checar
// sellsProducts). Preciso saber QUAL Store/armazem concentra os 60 cods de materia-prima achados
// antes, pra decidir a correcao certa (excluir esse armazem especifico do sync de estoque, ou
// ajustar sellsProducts/NAO_VENDE pra reconhece-lo).
(async () => {
  const semGrupo = await prisma.stockSnapshot.findMany({
    where: { grupo: "(sem grupo)" },
    select: { cod: true, produto: true, storeId: true, quantidadeDisponivel: true },
  });
  const storeIds = [...new Set(semGrupo.map((s) => s.storeId))];
  const stores = await prisma.store.findMany({
    where: { id: { in: storeIds } },
    select: { id: true, code: true, name: true, sellsProducts: true, dapicArmazenadorId: true },
  });
  console.log("--- Stores que concentram os itens '(sem grupo)' ---");
  for (const s of stores) {
    const n = semGrupo.filter((x) => x.storeId === s.id).length;
    console.log(`  ${s.code} / ${s.name} (sellsProducts=${s.sellsProducts}, dapicArmazenadorId=${s.dapicArmazenadorId}): ${n} linhas`);
  }

  // Confere também: será que ESSE MESMO armazém/store tem produto DE VERDADE (roupa, com grupo
  // real) junto? Se sim, excluir o armazém inteiro apagaria produto de verdade também -- preciso
  // saber antes de decidir a correção.
  for (const s of stores) {
    const totalNesseStore = await prisma.stockSnapshot.count({ where: { storeId: s.id } });
    const comGrupoReal = await prisma.stockSnapshot.count({ where: { storeId: s.id, grupo: { not: "(sem grupo)" } } });
    console.log(`  -> ${s.code}: total ${totalNesseStore} linhas, ${comGrupoReal} com grupo real (roupa de verdade)`);
  }

  // Todos os Stores que NÃO vendem (sellsProducts=false), pra contexto geral.
  const naoVende = await prisma.store.findMany({ where: { sellsProducts: false }, select: { code: true, name: true } });
  console.log("\n--- Todos os Stores com sellsProducts=false (já reconhecidos como não-venda) ---");
  for (const s of naoVende) console.log(`  ${s.code} / ${s.name}`);

  await prisma.$disconnect();
})();
