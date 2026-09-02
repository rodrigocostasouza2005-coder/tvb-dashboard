"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { setCoberturaMeta } from "@/lib/metrics";

export async function updateCoberturaMetaAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) return;

  const grupo = String(formData.get("grupo") ?? "");
  const meses = Number(formData.get("mesesCobertura"));
  if (!grupo || !Number.isFinite(meses) || meses <= 0) return;

  await setCoberturaMeta(grupo, meses);
  revalidatePath("/dashboard/mapa-compras");
}
