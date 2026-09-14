"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import type { ContentClassificacao, ContentTipo } from "@prisma/client";

async function requireGestao() {
  const user = await getSessionUser();
  if (!user || (user.role !== "ADMIN" && user.role !== "GESTAO")) {
    throw new Error("Sem permissão.");
  }
  return user;
}

function parseForm(formData: FormData) {
  const perfil = String(formData.get("perfil") ?? "").trim();
  const tipo = String(formData.get("tipo") ?? "");
  const classificacao = String(formData.get("classificacao") ?? "");
  const dataStr = String(formData.get("data") ?? "");
  const engajamentoRaw = String(formData.get("engajamento") ?? "").trim();
  const observacoes = String(formData.get("observacoes") ?? "").trim();

  if (!perfil || !dataStr) throw new Error("Perfil e data são obrigatórios.");
  if (tipo !== "STORY" && tipo !== "POST") throw new Error("Tipo inválido.");
  if (classificacao !== "QUALIFICADO" && classificacao !== "BASICO") throw new Error("Classificação inválida.");

  return {
    perfil,
    tipo: tipo as ContentTipo,
    classificacao: classificacao as ContentClassificacao,
    data: new Date(`${dataStr}T12:00:00.000-03:00`),
    engajamento: engajamentoRaw === "" ? null : Number(engajamentoRaw),
    observacoes: observacoes === "" ? null : observacoes,
  };
}

export async function createContentAction(formData: FormData) {
  const user = await requireGestao();
  const parsed = parseForm(formData);

  await prisma.contentPerformance.create({
    data: { ...parsed, registradoPor: user.name },
  });

  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/analise-performance");
}

export async function updateContentAction(formData: FormData) {
  await requireGestao();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Id ausente.");
  const parsed = parseForm(formData);

  await prisma.contentPerformance.update({ where: { id }, data: parsed });

  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/analise-performance");
}

export async function deleteContentAction(formData: FormData) {
  await requireGestao();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.contentPerformance.delete({ where: { id } });

  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/analise-performance");
}
