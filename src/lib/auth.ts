import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME, VENDEDOR_COOKIE_NAME } from "@/lib/constants";
import type { Role } from "@prisma/client";

const SESSION_COOKIE = SESSION_COOKIE_NAME;
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string) {
  const session = await prisma.session.create({
    data: {
      userId,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
  }
  cookieStore.delete(SESSION_COOKIE);
  // Some junto do logout — evita que o próximo login nesse computador (loja diferente, ou
  // mesma loja outro turno) herde o vendedor selecionado por engano.
  cookieStore.delete(VENDEDOR_COOKIE_NAME);
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  allowedTabs: string[];
  allowedStores: string[];
  allowedMarcas: string[];
  allowedTabelasPreco: string[];
  canSeeFinancials: boolean;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) return null;

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
    allowedTabs: session.user.allowedTabs,
    allowedStores: session.user.allowedStores,
    allowedMarcas: session.user.allowedMarcas,
    allowedTabelasPreco: session.user.allowedTabelasPreco,
    canSeeFinancials: session.user.canSeeFinancials,
  };
}

// Vendedor selecionado na aba Sugestões de Contato (identificação simples, sem senha/login
// próprio — ver VENDEDOR_COOKIE_NAME). O valor lido aqui é só o que está salvo no cookie; quem
// chama DEVE cruzar contra a lista de vendedores permitidos pro login atual (getVendedores com
// os allowedStores do usuário) antes de usar — nunca confiar nesse valor sozinho, pedido do
// Rodrigo em 2026-09-18 ("essa validação não deve existir somente no frontend").
export async function getVendedorAtualCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(VENDEDOR_COOKIE_NAME)?.value ?? null;
}

export async function setVendedorAtualCookie(nome: string) {
  const cookieStore = await cookies();
  cookieStore.set(VENDEDOR_COOKIE_NAME, nome, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Sem "expires" — cookie de sessão do navegador, some ao fechar (computador da loja é
    // compartilhado entre vendedores; não faz sentido persistir por dias).
  });
}

export async function clearVendedorAtualCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(VENDEDOR_COOKIE_NAME);
}
