"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { hashPassword, getSessionUser } from "@/lib/auth";
import { TABS, type TabKey } from "@/lib/tabs";
import { runSync } from "@/lib/sync-runner";
import type { Role } from "@prisma/client";

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") {
    throw new Error("Só administradores podem fazer isso.");
  }
  return user;
}

function readAllowedTabs(formData: FormData): string[] {
  const keys = TABS.map((t) => t.key);
  return formData
    .getAll("tab")
    .map(String)
    .filter((k): k is TabKey => (keys as string[]).includes(k));
}

function readAllowedStores(formData: FormData): string[] {
  return formData.getAll("store").map(String).filter(Boolean);
}

export async function createUserAction(formData: FormData) {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "VENDEDOR") as Role;
  const allowedTabs = readAllowedTabs(formData);
  const allowedStores = readAllowedStores(formData);

  if (!name || !email || !password) return;

  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: { name, email, passwordHash, role, allowedTabs, allowedStores },
  });

  revalidatePath("/dashboard/admin");
}

export async function updateUserAction(formData: FormData) {
  await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "VENDEDOR") as Role;
  const allowedTabs = readAllowedTabs(formData);
  const allowedStores = readAllowedStores(formData);
  if (!userId) return;

  await prisma.user.update({
    where: { id: userId },
    data: { role, allowedTabs, allowedStores },
  });

  revalidatePath("/dashboard/admin");
}

export async function resetPasswordAction(formData: FormData) {
  await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!userId || !password) return;

  const passwordHash = await hashPassword(password);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  revalidatePath("/dashboard/admin");
}

export async function deleteUserAction(formData: FormData) {
  const admin = await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  if (!userId || userId === admin.id) return; // não deixa se autoexcluir

  const remainingAdmins = await prisma.user.count({ where: { role: "ADMIN", id: { not: userId } } });
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (target?.role === "ADMIN" && remainingAdmins === 0) return; // não deixa zerar os admins

  await prisma.user.delete({ where: { id: userId } });

  revalidatePath("/dashboard/admin");
}

// runSync() já dispara o aviso no Telegram sozinho (sucesso ou falha) — não precisa duplicar
// aqui. Pedido do Rodrigo em 2026-08-12: botão pra não precisar esperar o cron das 8h/17h.
export async function forceSyncAction(): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  try {
    const response = await runSync();
    const data = await response.json();
    if (data.ok) {
      return {
        ok: true,
        message: `Sincronizado: ${data.estoque} estoque, ${data.vendas} vendas, ${data.devolucoes} devoluções, ${data.brindes} brindes, ${data.ordensProducao} ordens de produção. Aviso enviado no Telegram.`,
      };
    }
    return { ok: false, message: data.error ?? "Falha desconhecida na sincronização." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
