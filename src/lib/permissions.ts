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

export function canSeeFinancials(role: Role) {
  return role !== "VENDEDOR";
}

// Retorna a lista de grupos que o usuário pode ver (undefined = sem restrição).
// Usar como `filters.grupoIn` nas funções de lib/metrics.ts — funciona em qualquer
// dimensão (grupo/produto/tamanho) porque filtra na origem (linha de venda/estoque).
export async function getGrupoRestriction(role: Role): Promise<string[] | undefined> {
  if (role !== "VENDEDOR") return undefined;
  return getPriorityGroups();
}
