"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { setCoberturaMeta, setCrescimentoEsperado } from "@/lib/metrics";

// Cobertura e Crescimento alimentam a recomendação de quanto comprar pra empresa toda — só
// ADMIN/GESTAO pode mudar (mesmo padrão de estoque-minimo/actions.ts). Achado numa auditoria em
// 2026-09-08: antes só checava se tinha usuário logado, então qualquer VENDEDOR conseguia mudar.
async function requireGestao() {
  const user = await getSessionUser();
  if (!user || (user.role !== "ADMIN" && user.role !== "GESTAO")) {
    throw new Error("Sem permissão.");
  }
}

export async function updateCoberturaMetaAction(formData: FormData) {
  await requireGestao();

  const grupo = String(formData.get("grupo") ?? "");
  const meses = Number(formData.get("mesesCobertura"));
  if (!grupo || !Number.isFinite(meses) || meses <= 0) return;

  await setCoberturaMeta(grupo, meses);
  revalidatePath("/dashboard/mapa-compras");
}

export async function updateCrescimentoAction(formData: FormData) {
  await requireGestao();

  const crescimentoPct = Number(formData.get("crescimentoPct"));
  if (!Number.isFinite(crescimentoPct)) return;

  await setCrescimentoEsperado(crescimentoPct);
  revalidatePath("/dashboard/mapa-compras");
}
