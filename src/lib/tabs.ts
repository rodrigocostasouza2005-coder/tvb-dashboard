import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";

export type TabKey =
  | "visao-geral"
  | "vendas"
  | "mensal"
  | "brindes"
  | "estoque-atual"
  | "estoque"
  | "sellthrough"
  | "reposicao"
  | "pesquisa"
  | "clientes"
  | "vendedores"
  | "marketing"
  | "estoque-minimo"
  | "envelhecimento"
  | "cobertura";

export const TABS: { key: TabKey; label: string; href: string }[] = [
  { key: "visao-geral", label: "Visão Geral", href: "/dashboard" },
  { key: "vendas", label: "Vendas", href: "/dashboard/vendas" },
  { key: "mensal", label: "Mensal", href: "/dashboard/mensal" },
  { key: "brindes", label: "Brinde", href: "/dashboard/brindes" },
  { key: "estoque-atual", label: "Estoque Atual", href: "/dashboard/estoque-atual" },
  { key: "estoque", label: "Estoque × Vendas", href: "/dashboard/estoque" },
  { key: "sellthrough", label: "Sellthrough & Giro", href: "/dashboard/sellthrough" },
  { key: "reposicao", label: "Reposição de Lojas", href: "/dashboard/reposicao" },
  { key: "pesquisa", label: "Pesquisa", href: "/dashboard/pesquisa" },
  { key: "clientes", label: "Clientes", href: "/dashboard/clientes" },
  { key: "vendedores", label: "Vendedores", href: "/dashboard/vendedores" },
  { key: "marketing", label: "Marketing", href: "/dashboard/marketing" },
  { key: "estoque-minimo", label: "Estoque Mínimo", href: "/dashboard/estoque-minimo" },
  { key: "envelhecimento", label: "Envelhecimento", href: "/dashboard/envelhecimento" },
  { key: "cobertura", label: "Cobertura", href: "/dashboard/cobertura" },
];

const BLOCKED_BY_DEFAULT_FOR_VENDEDOR: TabKey[] = ["clientes", "vendedores", "estoque-minimo"];

export function defaultAllowedTabs(role: Role): TabKey[] {
  if (role === "VENDEDOR") {
    return TABS.map((t) => t.key).filter((k) => !BLOCKED_BY_DEFAULT_FOR_VENDEDOR.includes(k));
  }
  return TABS.map((t) => t.key);
}

export function hasTabAccess(user: { allowedTabs: string[] }, tab: TabKey, role: Role): boolean {
  const allowed = user.allowedTabs.length > 0 ? user.allowedTabs : defaultAllowedTabs(role);
  return allowed.includes(tab);
}

// Chama no topo de cada página de aba — redireciona para a primeira aba permitida se não tiver acesso.
export function requireTabAccess(user: { allowedTabs: string[] }, role: Role, tab: TabKey) {
  if (!hasTabAccess(user, tab, role)) {
    const allowed = user.allowedTabs.length > 0 ? user.allowedTabs : defaultAllowedTabs(role);
    const first = TABS.find((t) => allowed.includes(t.key));
    redirect(first?.href ?? "/dashboard");
  }
}
