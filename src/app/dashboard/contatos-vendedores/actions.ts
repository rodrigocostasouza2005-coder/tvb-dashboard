"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") {
    throw new Error("Só administradores podem fazer isso.");
  }
  return user;
}

// Excluir um contato marcado — pedido do Rodrigo em 2026-09-18, só ADMIN (nem Gestão). Usa a
// mesma chave natural do ContatoMarcado (tipo+cliente+chave, ver schema.prisma).
export async function deletarContatoAction(formData: FormData) {
  await requireAdmin();

  const tipo = String(formData.get("tipo") ?? "");
  const cliente = String(formData.get("cliente") ?? "");
  const chave = String(formData.get("chave") ?? "");
  if (!tipo || !cliente || !chave) return;

  await prisma.contatoMarcado.deleteMany({ where: { tipo, cliente, chave } });
  revalidatePath("/dashboard/contatos-vendedores");
}
