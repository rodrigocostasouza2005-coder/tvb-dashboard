// Correção pontual, rodada uma vez: apaga as 96 linhas duplicadas das faturas NITHI (11473) e
// PROS (11472), achado em 2026-10-01 (ver comentário em resolveStoreIdsEstaveis, sync-runner.ts).
// Cada item ficou gravado 2x (loja CD e loja ATACADO) porque a classificação de canal mudou entre
// duas sincronizações da mesma fatura (commit 87ead95). Mantém a cópia em ATACADO (classificação
// atual correta), apaga a cópia em CD. Confirmado antes de rodar: as duas cópias de cada item têm
// exatamente o mesmo valor/quantidade, só a loja difere.
import { prisma } from "@/lib/prisma";

const CD = "cmsi0h80a0001uza8axxzbjhv";
const ATACADO = "cmsjjcwqq0000uz40onbfo2vd";

async function main() {
  const rows = await prisma.sale.findMany({
    where: { dapicVendaId: { in: [11473, 11472] } },
    select: { id: true, storeId: true, dapicVendaId: true, itemIndex: true, valorTotalLiquido: true, quantidade: true },
  });
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.dapicVendaId}::${r.itemIndex}`;
    const arr = byKey.get(k) ?? [];
    arr.push(r);
    byKey.set(k, arr);
  }

  const idsParaDeletar: string[] = [];
  let valorRemovido = 0;
  let qtdRemovida = 0;
  for (const [, arr] of byKey) {
    if (arr.length !== 2) {
      console.log("ANOMALIA, esperado 2:", arr);
      continue;
    }
    const cd = arr.find((r) => r.storeId === CD);
    const atacado = arr.find((r) => r.storeId === ATACADO);
    if (!cd || !atacado) {
      console.log("ANOMALIA, não achou par CD+ATACADO:", arr);
      continue;
    }
    if (cd.valorTotalLiquido !== atacado.valorTotalLiquido || cd.quantidade !== atacado.quantidade) {
      console.log("ANOMALIA, valores diferentes entre as cópias:", { cd, atacado });
      continue;
    }
    idsParaDeletar.push(cd.id);
    valorRemovido += cd.valorTotalLiquido;
    qtdRemovida += cd.quantidade;
  }

  console.log(`Linhas a deletar (cópia CD, mantendo a cópia ATACADO): ${idsParaDeletar.length}`);
  console.log(`Valor a remover: R$${valorRemovido.toFixed(2)}, peças: ${qtdRemovida}`);

  const result = await prisma.sale.deleteMany({ where: { id: { in: idsParaDeletar } } });
  console.log(`Deletadas: ${result.count}`);

  const check = await prisma.sale.count({ where: { dapicVendaId: { in: [11473, 11472] } } });
  console.log(`Linhas restantes pros 2 pedidos: ${check} (esperado 96)`);
}

main().finally(() => prisma.$disconnect());
