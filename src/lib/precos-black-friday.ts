import { prisma } from "@/lib/prisma";

// Upsert compartilhado por grupo+produto — usado tanto pelo script local
// (scripts/black-friday/importar-precos.ts, lê o .xlsx direto) quanto pela Server Action do Admin
// (importarPrecosBlackFridayAction, lê data/precos-black-friday.json já parseado e commitado no
// repo, sem precisar de "xlsx" em produção). Ver comentário do model PrecoBlackFriday no schema.
export type PrecoBlackFridayInput = {
  grupo: string;
  produto: string;
  colecao: string | null;
  precoCheio: number | null;
  desconto: number;
  precoComDesconto: number | null;
};

export async function upsertPrecosBlackFriday(
  rows: PrecoBlackFridayInput[]
): Promise<{ criadas: number; atualizadas: number }> {
  let criadas = 0;
  let atualizadas = 0;

  for (const v of rows) {
    const existing = await prisma.precoBlackFriday.findUnique({
      where: { grupo_produto: { grupo: v.grupo, produto: v.produto } },
    });
    await prisma.precoBlackFriday.upsert({
      where: { grupo_produto: { grupo: v.grupo, produto: v.produto } },
      create: {
        grupo: v.grupo,
        produto: v.produto,
        colecao: v.colecao,
        precoCheio: v.precoCheio,
        desconto: v.desconto,
        precoComDesconto: v.precoComDesconto,
      },
      update: {
        colecao: v.colecao,
        precoCheio: v.precoCheio,
        desconto: v.desconto,
        precoComDesconto: v.precoComDesconto,
      },
    });
    if (existing) atualizadas++;
    else criadas++;
  }

  return { criadas, atualizadas };
}
