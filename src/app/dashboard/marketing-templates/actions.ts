"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { TEMPLATE_KEYS, defaultTextoFor, type TemplateKey } from "@/lib/message-templates";

async function requireGestao() {
  const user = await getSessionUser();
  if (!user || (user.role !== "ADMIN" && user.role !== "GESTAO")) {
    throw new Error("Sem permissão.");
  }
}

const VALID_KEYS = new Set(TEMPLATE_KEYS.map((t) => t.key));

export async function salvarTemplateAction(formData: FormData) {
  await requireGestao();

  const key = String(formData.get("key") ?? "");
  if (!VALID_KEYS.has(key as TemplateKey)) throw new Error("Template inválido.");
  const texto = String(formData.get("texto") ?? "").trim();
  if (!texto) throw new Error("Texto não pode ficar vazio.");

  await prisma.mensagemTemplate.upsert({
    where: { id: key },
    create: { id: key, texto },
    update: { texto },
  });
  revalidatePath("/dashboard/clientes-sugestoes-contato");
  redirect("/dashboard/marketing-templates?ok=1");
}

export async function restaurarPadraoAction(formData: FormData) {
  await requireGestao();

  const key = String(formData.get("key") ?? "");
  if (!VALID_KEYS.has(key as TemplateKey)) throw new Error("Template inválido.");

  await prisma.mensagemTemplate.upsert({
    where: { id: key },
    create: { id: key, texto: defaultTextoFor(key as TemplateKey) },
    update: { texto: defaultTextoFor(key as TemplateKey) },
  });
  revalidatePath("/dashboard/clientes-sugestoes-contato");
  redirect("/dashboard/marketing-templates?ok=1");
}
