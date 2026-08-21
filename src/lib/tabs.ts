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
  | "atacado"
  | "atacado-cidades"
  | "atacado-clientes"
  | "cobertura"
  | "inadimplencia";

export type TabGroup = "visao-geral" | "vendas" | "estoque" | "atacado" | "marketing" | "outros";

export type TabEntry =
  | { key: TabKey; label: string; href: string; group: TabGroup; todo?: false }
  | { key?: never; label: string; href?: never; group: TabGroup; todo: true };

export const TABS: TabEntry[] = [
  // visao-geral
  { key: "visao-geral", label: "Visão Geral", href: "/dashboard", group: "visao-geral" },

  // vendas
  { key: "vendas", label: "Família/produto/tamanho", href: "/dashboard/vendas", group: "vendas" },
  { key: "vendedores", label: "Por vendedor", href: "/dashboard/vendedores", group: "vendas" },
  { label: "Curva ABC", group: "vendas", todo: true },
  { label: "Comparativo vs. meta/ano ant.", group: "vendas", todo: true },

  // estoque
  { key: "estoque-atual", label: "Por família/produto/tamanho", href: "/dashboard/estoque-atual", group: "estoque" },
  { key: "cobertura", label: "Cobertura", href: "/dashboard/cobertura", group: "estoque" },
  { key: "sellthrough", label: "Sell-through", href: "/dashboard/sellthrough", group: "estoque" },
  { key: "envelhecimento", label: "Envelhecimento", href: "/dashboard/envelhecimento", group: "estoque" },
  { key: "reposicao", label: "Reposição de lojas", href: "/dashboard/reposicao", group: "estoque" },
  { label: "Mapa de compras best sellers", group: "estoque", todo: true },

  // atacado
  { key: "atacado", label: "Vendas", href: "/dashboard/atacado", group: "atacado" },
  { key: "atacado-cidades", label: "Por estado/cidade", href: "/dashboard/atacado-cidades", group: "atacado" },
  { key: "atacado-clientes", label: "Por cliente", href: "/dashboard/atacado-clientes", group: "atacado" },
  { key: "inadimplencia", label: "Inadimplência", href: "/dashboard/inadimplencia", group: "atacado" },

  // marketing
  { key: "clientes", label: "Clientes", href: "/dashboard/clientes", group: "marketing" },
  { label: "Top 10 mais vendidos", group: "marketing", todo: true },
  { label: "Top 10 menos vendidos", group: "marketing", todo: true },

  // outros
  { key: "brindes", label: "Brinde", href: "/dashboard/brindes", group: "outros" },
  { key: "pesquisa", label: "Pesquisa", href: "/dashboard/pesquisa", group: "outros" },

  // not in nav but still have keys (keep for access control)
  { key: "mensal", label: "Mensal", href: "/dashboard/mensal", group: "outros" },
  { key: "estoque", label: "Estoque × Vendas", href: "/dashboard/estoque", group: "outros" },
  { key: "marketing", label: "Marketing", href: "/dashboard/marketing", group: "marketing" },
  { key: "estoque-minimo", label: "Estoque Mínimo", href: "/dashboard/estoque-minimo", group: "outros" },
];

export const GROUPS: { key: TabGroup; label: string; single?: boolean }[] = [
  { key: "visao-geral", label: "Visão Geral", single: true },
  { key: "vendas", label: "Vendas" },
  { key: "estoque", label: "Estoque" },
  { key: "atacado", label: "Atacado" },
  { key: "marketing", label: "Marketing" },
  { key: "outros", label: "…" },
];

const BLOCKED_BY_DEFAULT_FOR_VENDEDOR: TabKey[] = ["clientes", "vendedores", "estoque-minimo"];

export function defaultAllowedTabs(role: Role): TabKey[] {
  const keys = TABS.filter((t): t is Extract<TabEntry, { key: TabKey }> => t.key !== undefined).map((t) => t.key);
  if (role === "VENDEDOR") {
    return keys.filter((k) => !BLOCKED_BY_DEFAULT_FOR_VENDEDOR.includes(k));
  }
  return keys;
}

export function hasTabAccess(user: { allowedTabs: string[] }, tab: TabKey, role: Role): boolean {
  const allowed = user.allowedTabs.length > 0 ? user.allowedTabs : defaultAllowedTabs(role);
  return allowed.includes(tab);
}

// Chama no topo de cada página de aba — redireciona para a primeira aba permitida se não tiver acesso.
export function requireTabAccess(user: { allowedTabs: string[] }, role: Role, tab: TabKey) {
  if (!hasTabAccess(user, tab, role)) {
    const allowed = user.allowedTabs.length > 0 ? user.allowedTabs : defaultAllowedTabs(role);
    const first = TABS.filter((t): t is Extract<TabEntry, { key: TabKey }> => t.key !== undefined).find((t) =>
      allowed.includes(t.key)
    );
    redirect(first?.href ?? "/dashboard");
  }
}
