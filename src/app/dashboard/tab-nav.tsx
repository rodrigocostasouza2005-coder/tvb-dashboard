"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { TABS, type TabKey } from "@/lib/tabs";

// Params de filtro que devem ser carregados ao trocar de aba.
// "dim" é propositalmente excluído — cada aba tem seu próprio toggle de dimensão.
const FILTER_PARAMS = ["from", "to", "store", "marca", "tabelaPreco"];

export function TabNav({ visibleKeys, isAdmin }: { visibleKeys: TabKey[]; isAdmin: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const visible = new Set(visibleKeys);

  // Monta query string só com os params de filtro (ignora dim e outros params de aba)
  const filterQs = (() => {
    const p = new URLSearchParams();
    for (const key of FILTER_PARAMS) {
      for (const val of searchParams.getAll(key)) {
        p.append(key, val);
      }
    }
    const s = p.toString();
    return s ? `?${s}` : "";
  })();

  const links = [
    { href: "/dashboard", label: "Visão Geral" },
    ...TABS.filter((t) => visible.has(t.key)),
    ...(isAdmin ? [{ href: "/dashboard/admin", label: "Admin" }] : []),
  ];

  return (
    <nav className="mx-auto flex max-w-7xl flex-wrap gap-1 px-6">
      {links.map((tab) => {
        const active =
          tab.href === "/dashboard" ? pathname === "/dashboard" : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={`${tab.href}${filterQs}`}
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
