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
  | "inadimplencia"
  | "top-mais-vendidos"
  | "top-menos-vendidos"
  | "curva-abc"
  | "lamina-mensal"
  | "indicadores"
  | "clientes-segmentacao"
  | "clientes-ficha"
  | "clientes-produto"
  | "clientes-produtos-entrada"
  | "clientes-sugestoes-contato"
  | "estoque-retirada"
  | "mapa-compras";

export type TabGroup = "visao-geral" | "vendas" | "estoque" | "atacado" | "clientes" | "marketing" | "pesquisa" | "lamina" | "outros";

export type TabEntry =
  | { key: TabKey; label: string; href: string; group: TabGroup; todo?: false }
  | { key?: never; label: string; href?: never; group: TabGroup; todo: true };

export const TABS: TabEntry[] = [
  // visao-geral
  { key: "visao-geral", label: "Visão Geral", href: "/dashboard", group: "visao-geral" },

  // lamina mensal (direct link, like visao-geral)
  { key: "lamina-mensal", label: "Lâmina Mensal", href: "/dashboard/lamina-mensal", group: "lamina" },

  // vendas
  { key: "vendas", label: "Família/produto/tamanho", href: "/dashboard/vendas", group: "vendas" },
  { key: "vendedores", label: "Por vendedor", href: "/dashboard/vendedores", group: "vendas" },
  { key: "brindes", label: "Brinde", href: "/dashboard/brindes", group: "vendas" },
  { key: "curva-abc", label: "Curva ABC", href: "/dashboard/curva-abc", group: "vendas" },
  { key: "indicadores", label: "Indicadores no Tempo", href: "/dashboard/indicadores", group: "vendas" },
  { label: "Comparativo vs. meta/ano ant.", group: "vendas", todo: true },

  // estoque
  { key: "estoque-atual", label: "Por família/produto/tamanho", href: "/dashboard/estoque-atual", group: "estoque" },
  { key: "estoque", label: "Estoque × Vendas", href: "/dashboard/estoque", group: "estoque" },
  { key: "cobertura", label: "Cobertura", href: "/dashboard/cobertura", group: "estoque" },
  { key: "sellthrough", label: "Sell-through", href: "/dashboard/sellthrough", group: "estoque" },
  { key: "envelhecimento", label: "Envelhecimento", href: "/dashboard/envelhecimento", group: "estoque" },
  { key: "reposicao", label: "Reposição de lojas", href: "/dashboard/reposicao", group: "estoque" },
  { key: "estoque-minimo", label: "Estoque Mínimo", href: "/dashboard/estoque-minimo", group: "estoque" },
  { key: "estoque-retirada", label: "Sugestão de Retirada", href: "/dashboard/estoque-retirada", group: "estoque" },
  { key: "mapa-compras", label: "Mapa de Compras", href: "/dashboard/mapa-compras", group: "estoque" },

  // atacado
  { key: "atacado", label: "Vendas", href: "/dashboard/atacado", group: "atacado" },
  { key: "atacado-cidades", label: "Por estado/cidade", href: "/dashboard/atacado-cidades", group: "atacado" },
  { key: "atacado-clientes", label: "Por cliente", href: "/dashboard/atacado-clientes", group: "atacado" },
  { key: "inadimplencia", label: "Inadimplência", href: "/dashboard/inadimplencia", group: "atacado" },

  // clientes
  { key: "clientes", label: "Visão Geral", href: "/dashboard/clientes", group: "clientes" },
  { key: "clientes-segmentacao", label: "Segmentação", href: "/dashboard/clientes-segmentacao", group: "clientes" },
  { key: "clientes-ficha", label: "Ficha do Cliente", href: "/dashboard/clientes-ficha", group: "clientes" },
  { key: "clientes-produto", label: "Produto → Cliente", href: "/dashboard/clientes-produto", group: "clientes" },
  { key: "clientes-produtos-entrada", label: "Produtos de Entrada", href: "/dashboard/clientes-produtos-entrada", group: "clientes" },
  { key: "clientes-sugestoes-contato", label: "Sugestões de Contato", href: "/dashboard/clientes-sugestoes-contato", group: "clientes" },

  // marketing
  { key: "top-mais-vendidos", label: "Top 10 mais vendidos", href: "/dashboard/top-mais-vendidos", group: "marketing" },
  { key: "top-menos-vendidos", label: "Top 10 menos vendidos", href: "/dashboard/top-menos-vendidos", group: "marketing" },

  // pesquisa (direct link, like visao-geral)
  { key: "pesquisa", label: "Pesquisa", href: "/dashboard/pesquisa", group: "pesquisa" },

  // not in nav but still have keys (keep for access control)
  { key: "mensal", label: "Mensal", href: "/dashboard/mensal", group: "outros" },

  // back in nav
  { key: "marketing", label: "Marketing", href: "/dashboard/marketing", group: "marketing" },
];

export const GROUPS: { key: TabGroup; label: string; single?: boolean }[] = [
  { key: "visao-geral", label: "Visão Geral", single: true },
  { key: "lamina", label: "Lâmina Mensal", single: true },
  { key: "vendas", label: "Vendas" },
  { key: "estoque", label: "Estoque" },
  { key: "atacado", label: "Atacado" },
  { key: "clientes", label: "Clientes" },
  { key: "marketing", label: "Marketing" },
  { key: "pesquisa", label: "Pesquisa", single: true },
];

const BLOCKED_BY_DEFAULT_FOR_VENDEDOR: TabKey[] = [
  "clientes", "clientes-segmentacao", "clientes-ficha", "clientes-produto", "clientes-produtos-entrada", "vendedores", "estoque-minimo",
];

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
