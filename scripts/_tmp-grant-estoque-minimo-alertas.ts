import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Grant aditivo e pontual (2026-11-24): a aba nova "estoque-minimo-alertas" não aparece sozinha
// pra ninguém com allowedTabs customizado (role ADMIN/GESTAO que já teve acesso restrito via
// /dashboard/admin no passado) -- defaultAllowedTabs só se aplica quando allowedTabs está vazio.
// Só ADICIONA a chave nova pra quem já é ADMIN/GESTAO e já tinha allowedTabs não-vazio contendo
// "estoque-minimo-manual" (ou seja, já tinha acesso ao conceito "mínimo da empresa", só falta a
// aba de alerta nova). Nunca mexe em VENDEDOR, nunca remove nada, nunca toca allowedTabs vazio
// (esses já recebem tudo automaticamente via defaultAllowedTabs).
const APLICAR = process.argv.includes("--apply");

(async () => {
  const candidatos = await prisma.user.findMany({
    where: {
      role: { in: ["ADMIN", "GESTAO"] },
      allowedTabs: { isEmpty: false },
    },
    select: { id: true, email: true, role: true, allowedTabs: true },
  });

  console.log(`Modo: ${APLICAR ? "APLICAR (vai escrever)" : "DRY RUN (só leitura)"}`);
  console.log(`Candidatos ADMIN/GESTAO com allowedTabs customizado: ${candidatos.length}`);

  for (const u of candidatos) {
    const jaTem = u.allowedTabs.includes("estoque-minimo-alertas");
    const tinhaMinimoManual = u.allowedTabs.includes("estoque-minimo-manual");
    console.log(
      `  ${u.email} (${u.role}) — já tem alertas: ${jaTem} — tinha estoque-minimo-manual: ${tinhaMinimoManual}`
    );
    if (jaTem || !tinhaMinimoManual) continue;

    const novoAllowedTabs = [...u.allowedTabs, "estoque-minimo-alertas"];
    if (APLICAR) {
      await prisma.user.update({ where: { id: u.id }, data: { allowedTabs: novoAllowedTabs } });
      console.log(`    -> ATUALIZADO: adicionado "estoque-minimo-alertas"`);
    } else {
      console.log(`    -> seria atualizado: adicionado "estoque-minimo-alertas"`);
    }
  }

  await prisma.$disconnect();
})();
