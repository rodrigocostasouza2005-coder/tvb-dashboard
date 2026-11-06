import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { brasiliaDayStart } from "@/lib/filters";

// Upsert compartilhado por data — usado tanto pelo script local
// (scripts/black-friday/importar-meta-diaria.ts, lê o .xlsx direto) quanto pela Server Action do
// Admin (importarMetaDiariaBlackFridayAction, lê data/meta-diaria-black-friday.json já parseado e
// commitado no repo, sem precisar de "xlsx" em produção). Mesmo padrão de
// src/lib/precos-black-friday.ts. Ver comentário do model MetaDiariaBlackFriday no schema.
export type MetaDiariaBlackFridayInput = {
  // "YYYY-MM-DD" (dia de Brasília) — convertido aqui pra Date via brasiliaDayStart, igual
  // parseFilters() faz pro resto do dashboard, pra bater com o "day" que getSalesByDay devolve.
  data: string;
  metaReceita2026: number;
  receitaReal2025: number | null;
  acao: string | null;
  canais: Record<string, unknown> | null;
};

export async function upsertMetaDiariaBlackFriday(
  rows: MetaDiariaBlackFridayInput[]
): Promise<{ criadas: number; atualizadas: number }> {
  let criadas = 0;
  let atualizadas = 0;

  for (const v of rows) {
    const data = brasiliaDayStart(v.data);
    const existing = await prisma.metaDiariaBlackFriday.findUnique({ where: { data } });
    await prisma.metaDiariaBlackFriday.upsert({
      where: { data },
      create: {
        data,
        metaReceita2026: v.metaReceita2026,
        receitaReal2025: v.receitaReal2025,
        acao: v.acao,
        canais: (v.canais ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      },
      update: {
        metaReceita2026: v.metaReceita2026,
        receitaReal2025: v.receitaReal2025,
        acao: v.acao,
        canais: (v.canais ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      },
    });
    if (existing) atualizadas++;
    else criadas++;
  }

  return { criadas, atualizadas };
}
