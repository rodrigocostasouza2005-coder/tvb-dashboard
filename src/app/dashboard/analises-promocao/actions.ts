"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { savePromotionRulesConfig, type PromotionRulesData } from "@/lib/metrics";

// Editar a regra de desconto afeta a análise pra todo mundo que abrir a aba — mesmo padrão de
// restrição de mapa-compras/actions.ts (só ADMIN/GESTAO muda configuração compartilhada).
async function requireGestao() {
  const user = await getSessionUser();
  if (!user || (user.role !== "ADMIN" && user.role !== "GESTAO")) {
    throw new Error("Sem permissão.");
  }
}

export async function salvarRegrasPromocaoAction(data: PromotionRulesData): Promise<{ ok: boolean; erro?: string }> {
  try {
    await requireGestao();
  } catch {
    return { ok: false, erro: "Sem permissão pra salvar." };
  }
  await savePromotionRulesConfig(data);
  revalidatePath("/dashboard/analises-promocao");
  return { ok: true };
}
