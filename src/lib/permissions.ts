import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";

let priorityGroupsCache: { at: number; groups: string[] } | null = null;
const CACHE_TTL_MS = 30_000;

export async function getPriorityGroups(): Promise<string[]> {
  if (priorityGroupsCache && Date.now() - priorityGroupsCache.at < CACHE_TTL_MS) {
    return priorityGroupsCache.groups;
  }
  const rows = await prisma.priorityGroup.findMany();
  const groups = rows.map((r) => r.grupo);
  priorityGroupsCache = { at: Date.now(), groups };
  return groups;
}

export function canSeeFinancials(user: { canSeeFinancials: boolean }) {
  return user.canSeeFinancials;
}

// Retorna a lista de grupos que o usuário pode ver (undefined = sem restrição).
// Usar como `filters.grupoIn` nas funções de lib/metrics.ts — funciona em qualquer
// dimensão (grupo/produto/tamanho) porque filtra na origem (linha de venda/estoque).
export async function getGrupoRestriction(role: Role): Promise<string[] | undefined> {
  if (role !== "VENDEDOR") return undefined;
  return getPriorityGroups();
}

// Lojas que o usuário pode ver — administrável por usuário em /dashboard/admin
// (User.allowedStores). SEMPRE retorna a lista concreta, mesmo vazia — vazio agora significa
// "não libera loja nenhuma" (default-deny), não mais "sem restrição". Trocado em 2026-08-12 a
// pedido do Rodrigo: antes vazio = via tudo, ele achou perigoso (usuário novo sem nada marcado
// via tudo por padrão). Usuários que já existiam antes dessa mudança foram migrados pra ter
// todas as opções marcadas explicitamente (scripts/migrate-explicit-allowlists.ts), então
// ninguém perdeu acesso — só usuário novo (ou editado de propósito) começa sem nada liberado.
export function getStoreRestriction(user: { allowedStores: string[] }): string[] {
  return user.allowedStores;
}

// Mesmo padrão de getStoreRestriction, pra Marca e Tabela de Preço.
export function getMarcaRestriction(user: { allowedMarcas: string[] }): string[] {
  return user.allowedMarcas;
}

export function getTabelaPrecoRestriction(user: { allowedTabelasPreco: string[] }): string[] {
  return user.allowedTabelasPreco;
}
