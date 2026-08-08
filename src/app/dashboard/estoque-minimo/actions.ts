"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

async function requireGestao() {
  const user = await getSessionUser();
  if (!user || (user.role !== "ADMIN" && user.role !== "GESTAO")) {
    throw new Error("Sem permissão.");
  }
}

export async function createMinimumRuleAction(formData: FormData) {
  await requireGestao();

  const storeId = String(formData.get("storeId") ?? "");
  const grupo = String(formData.get("grupo") ?? "").trim();
  const tamanho = String(formData.get("tamanho") ?? "").trim();
  const colecaoRaw = String(formData.get("colecao") ?? "").trim();
  const colecao = colecaoRaw === "" ? null : colecaoRaw;
  const valorMinimo = Number(formData.get("valorMinimo") ?? 0);

  if (!storeId || !grupo || !tamanho || !Number.isFinite(valorMinimo)) return;

  const existing = await prisma.stockMinimumRule.findFirst({
    where: { storeId, grupo, tamanho, colecao },
  });

  if (existing) {
    await prisma.stockMinimumRule.update({ where: { id: existing.id }, data: { valorMinimo } });
  } else {
    await prisma.stockMinimumRule.create({ data: { storeId, grupo, tamanho, colecao, valorMinimo } });
  }

  revalidatePath("/dashboard/estoque-minimo");
}

export async function deleteMinimumRuleAction(formData: FormData) {
  await requireGestao();

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.stockMinimumRule.delete({ where: { id } });
  revalidatePath("/dashboard/estoque-minimo");
}
