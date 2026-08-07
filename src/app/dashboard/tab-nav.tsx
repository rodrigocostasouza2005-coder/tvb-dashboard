"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, type TabKey } from "@/lib/tabs";

export function TabNav({ visibleKeys, isAdmin }: { visibleKeys: TabKey[]; isAdmin: boolean }) {
  const pathname = usePathname();
  const visible = new Set(visibleKeys);

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
