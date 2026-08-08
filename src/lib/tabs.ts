import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";

export type TabKey =
  | "vendas"
  | "estoque-atual"
  | "estoque"
  | "sellthrough"
  | "reposicao"
  | "pesquisa"
  | "clientes"
  | "vendedores"
  | "marketing"
  | "estoque-minimo"
  | "envelhecimento";

export const TABS: { key: TabKey; label: string; href: string }[] = [
  { key: "vendas", label: "Vendas", href: "/dashboard/vendas" },
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
];

// "Visão Geral" (/dashboard) não entra na lista — todo usuário logado sempre pode ver ela,
// é a página de pouso padrão.
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

// Chama no topo de cada página de aba — manda pra Visão Geral se o usuário não tiver acesso.
export function requireTabAccess(user: { allowedTabs: string[] }, role: Role, tab: TabKey) {
  if (!hasTabAccess(user, tab, role)) redirect("/dashboard");
}
