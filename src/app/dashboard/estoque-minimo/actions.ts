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

// Uma linha por tamanho do grupo escolhido, salvas todas juntas. "tamanho" e "valorMinimo" vêm
// como listas paralelas (um input por tamanho, mesmo name repetido — FormData.getAll preserva a
// ordem em que aparecem no form). Linha com o mínimo em branco é ignorada (não mexe na regra).
export async function createMinimumRulesBatchAction(formData: FormData) {
  await requireGestao();

  const storeId = String(formData.get("storeId") ?? "");
  const grupo = String(formData.get("grupo") ?? "").trim();
  const colecaoRaw = String(formData.get("colecao") ?? "").trim();
  const colecao = colecaoRaw === "" ? null : colecaoRaw;
  const tamanhos = formData.getAll("tamanho").map(String);
  const valores = formData.getAll("valorMinimo").map(String);

  if (!storeId || !grupo) return;

  for (let i = 0; i < tamanhos.length; i++) {
    const tamanho = tamanhos[i].trim();
    const raw = (valores[i] ?? "").trim();
    if (!tamanho || raw === "") continue;
    const valorMinimo = Number(raw);
    if (!Number.isFinite(valorMinimo)) continue;

    const existing = await prisma.stockMinimumRule.findFirst({
      where: { storeId, grupo, tamanho, colecao },
    });
    if (existing) {
      await prisma.stockMinimumRule.update({ where: { id: existing.id }, data: { valorMinimo } });
    } else {
      await prisma.stockMinimumRule.create({ data: { storeId, grupo, tamanho, colecao, valorMinimo } });
    }
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
