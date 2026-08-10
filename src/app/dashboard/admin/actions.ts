"use server";

import { revalidatePath } from "next/cache";
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
