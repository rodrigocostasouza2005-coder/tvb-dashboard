import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// Token único (não por usuário) pra integrações externas (Custom GPT do ChatGPT, Conector MCP
// do Claude) — dá acesso total aos dados do Radar, sem a separação por loja/financeiro do login
// normal. Guardado com hash (bcrypt), mesmo padrão de User.passwordHash — o valor puro só existe
// no instante em que é gerado (ver generateApiToken), nunca mais depois disso.
const API_TOKEN_ID = "radar-api";

export async function verifyApiToken(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const record = await prisma.apiToken.findUnique({ where: { id: API_TOKEN_ID } });
  if (!record) return false;
  return bcrypt.compare(token, record.tokenHash);
}

export async function getApiTokenStatus(): Promise<{ exists: boolean; updatedAt: Date | null }> {
  const record = await prisma.apiToken.findUnique({ where: { id: API_TOKEN_ID } });
  return { exists: !!record, updatedAt: record?.updatedAt ?? null };
}

// Gera um token novo (32 bytes aleatórios), substitui o anterior (invalida ele) e devolve o
// valor puro — é a ÚNICA vez que ele existe em texto puro fora do que a pessoa copiar.
export async function generateApiToken(): Promise<string> {
  const raw = crypto.randomBytes(32).toString("base64url");
  const tokenHash = await bcrypt.hash(raw, 10);
  await prisma.apiToken.upsert({
    where: { id: API_TOKEN_ID },
    create: { id: API_TOKEN_ID, tokenHash },
    update: { tokenHash },
  });
  return raw;
}
