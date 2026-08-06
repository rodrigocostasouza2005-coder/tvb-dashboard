"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard", label: "Visão Geral" },
  { href: "/dashboard/vendas", label: "Vendas" },
  { href: "/dashboard/estoque", label: "Estoque × Vendas" },
  { href: "/dashboard/sellthrough", label: "Sellthrough & Giro" },
  { href: "/dashboard/reposicao", label: "Reposição de Lojas" },
  { href: "/dashboard/pesquisa", label: "Pesquisa" },
  { href: "/dashboard/clientes", label: "Clientes" },
  { href: "/dashboard/marketing", label: "Marketing" },
];

export function TabNav() {
  const pathname = usePathname();

  return (
    <nav className="mx-auto flex max-w-7xl flex-wrap gap-1 px-6">
      {TABS.map((tab) => {
        const active = tab.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`border-b-2 px-3 py-2 text-sm ${
              active
                ? "border-[var(--series-1)] text-[var(--text-primary)]"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
