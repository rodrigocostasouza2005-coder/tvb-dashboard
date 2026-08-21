"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword, getSessionUser } from "@/lib/auth";
import { TABS, type TabKey } from "@/lib/tabs";
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

function readAllowedMarcas(formData: FormData): string[] {
  return formData.getAll("marca").map(String).filter(Boolean);
}

function readAllowedTabelasPreco(formData: FormData): string[] {
  return formData.getAll("tabelaPreco").map(String).filter(Boolean);
}

function readCanSeeFinancials(formData: FormData): boolean {
  return formData.get("canSeeFinancials") === "true";
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
  const allowedMarcas = readAllowedMarcas(formData);
  const allowedTabelasPreco = readAllowedTabelasPreco(formData);
  const canSeeFinancials = readCanSeeFinancials(formData);

  if (!name || !email || !password) return;

  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: { name, email, passwordHash, role, allowedTabs, allowedStores, allowedMarcas, allowedTabelasPreco, canSeeFinancials },
  });

  revalidatePath("/dashboard/admin");
  redirect("/dashboard/admin?ok=1");
}

export async function updateUserAction(formData: FormData) {
  await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "VENDEDOR") as Role;
  const allowedTabs = readAllowedTabs(formData);
  const allowedStores = readAllowedStores(formData);
  const allowedMarcas = readAllowedMarcas(formData);
  const allowedTabelasPreco = readAllowedTabelasPreco(formData);
  const canSeeFinancials = readCanSeeFinancials(formData);
  if (!userId) return;

  await prisma.user.update({
    where: { id: userId },
    data: { role, allowedTabs, allowedStores, allowedMarcas, allowedTabelasPreco, canSeeFinancials },
  });

  revalidatePath("/dashboard/admin");
  redirect("/dashboard/admin?ok=1");
}

export async function resetPasswordAction(formData: FormData) {
  await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!userId || !password) return;

  const passwordHash = await hashPassword(password);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  revalidatePath("/dashboard/admin");
  redirect("/dashboard/admin?ok=1");
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

// Fire-and-forget: dispara a sync via POST /api/sync (que tem maxDuration=300 próprio) e
// retorna imediatamente — o botão não trava mais a página. O Telegram avisa quando terminar.
export async function forceSyncAction(): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();

  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, message: "CRON_SECRET não configurado." };

  // Determina a URL base: em produção usa VERCEL_URL, localmente usa localhost.
  const host = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  // Dispara sem await — a requisição roda no seu próprio ciclo de vida no Vercel.
  fetch(`${host}/api/sync`, {
    method: "POST",
    headers: { "x-cron-secret": secret },
  }).catch(() => {
    // Erro de rede não deve travar a UI; o Telegram já vai avisar se a sync falhar.
  });

  return {
    ok: true,
    message: "Sincronização iniciada! Você vai receber um aviso no Telegram quando terminar.",
  };
}
