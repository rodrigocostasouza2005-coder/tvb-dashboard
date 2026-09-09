import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// Token único (não por usuário) pra integrações externas (Custom GPT do ChatGPT, Conector MCP
// do Claude) — dá acesso total aos dados do Radar, sem a separação por loja/financeiro do login
// normal. Guardado em texto puro (não hash como User.passwordHash) — decisão de propósito,
// pedido do Rodrigo em 2026-09-08 pra poder ver o token de novo pelo Painel Admin sem precisar
// reconectar ChatGPT/Claude toda vez que esquecer de copiar.
const API_TOKEN_ID = "radar-api";

export async function verifyApiToken(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const record = await prisma.apiToken.findUnique({ where: { id: API_TOKEN_ID } });
  return !!record && record.token === token;
}

export async function getApiTokenStatus(): Promise<{ exists: boolean; updatedAt: Date | null }> {
  const record = await prisma.apiToken.findUnique({ where: { id: API_TOKEN_ID } });
  return { exists: !!record, updatedAt: record?.updatedAt ?? null };
}

// Pro botão "Ver token" no Admin — só chamado sob demanda (Server Action), não fica pré-carregado
// no HTML da página.
export async function getApiToken(): Promise<string | null> {
  const record = await prisma.apiToken.findUnique({ where: { id: API_TOKEN_ID } });
  return record?.token ?? null;
}

// Gera um token novo (32 bytes aleatórios) e substitui o anterior (invalida ele) — usar só
// quando quiser trocar de verdade, já que qualquer coisa já conectada com o token antigo para de
// funcionar até você atualizar a configuração lá.
export async function generateApiToken(): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await prisma.apiToken.upsert({
    where: { id: API_TOKEN_ID },
    create: { id: API_TOKEN_ID, token },
    update: { token },
  });
  return token;
}
