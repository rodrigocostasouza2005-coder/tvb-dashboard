"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { GROUPS, TABS, type TabGroup, type TabKey } from "@/lib/tabs";

// Params de filtro que devem ser carregados ao trocar de aba.
// "dim" é propositalmente excluído — cada aba tem seu próprio toggle de dimensão.
const FILTER_PARAMS = ["from", "to", "store", "marca", "tabelaPreco"];

// Nav-only groups — tabs in these groups are NOT shown in the dropdown nav
// (they still exist as pages; access control still applies)
const NAV_HIDDEN_KEYS = new Set<TabKey>(["mensal", "estoque", "marketing", "estoque-minimo"]);

export function TabNav({ visibleKeys, isAdmin }: { visibleKeys: TabKey[]; isAdmin: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const visible = new Set(visibleKeys);
  const [openGroup, setOpenGroup] = useState<TabGroup | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenGroup(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close dropdown on route change
  useEffect(() => {
    setOpenGroup(null);
  }, [pathname]);

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

  function isPathActive(href: string) {
    return href === "/dashboard" ? pathname === "/dashboard" : pathname === href || pathname.startsWith(`${href}/`);
  }

  function isGroupActive(groupKey: TabGroup): boolean {
    return TABS.some(
      (t) =>
        t.group === groupKey &&
        t.key !== undefined &&
        !NAV_HIDDEN_KEYS.has(t.key as TabKey) &&
        t.href !== undefined &&
        isPathActive(t.href)
    );
  }

  return (
    <nav ref={navRef} className="mx-auto flex max-w-7xl flex-wrap items-center gap-1 px-6">
      {GROUPS.map((group) => {
        if (group.single) {
          // "Visão Geral" — direct link, no dropdown
          const entry = TABS.find((t) => t.group === group.key && t.key !== undefined);
          if (!entry || !entry.key || !entry.href) return null;
          if (!visible.has(entry.key as TabKey)) return null;
          const active = isPathActive(entry.href);
          return (
            <Link
              key={group.key}
              href={`${entry.href}${filterQs}`}
              className={`border-b-2 px-3 py-2 text-sm ${
                active
                  ? "border-[var(--series-1)] text-[var(--text-primary)]"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {group.label}
            </Link>
          );
        }

        // Gather nav-visible entries for this group
        const realEntries = TABS.filter(
          (t) =>
            t.group === group.key &&
            !t.todo &&
            t.key !== undefined &&
            !NAV_HIDDEN_KEYS.has(t.key as TabKey) &&
            visible.has(t.key as TabKey)
        );
        const todoEntries = TABS.filter((t) => t.group === group.key && t.todo === true);

        // Skip the entire group if there are no real entries and no todo entries
        if (realEntries.length === 0 && todoEntries.length === 0) return null;

        const active = isGroupActive(group.key);
        const isOpen = openGroup === group.key;

        return (
          <div key={group.key} className="relative">
            <button
              type="button"
              onClick={() => setOpenGroup(isOpen ? null : group.key)}
              className={`flex items-center gap-1 border-b-2 px-3 py-2 text-sm ${
                active
                  ? "border-[var(--series-1)] text-[var(--text-primary)]"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {group.label}
              <span className={`transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}>▾</span>
            </button>

            {isOpen && (
              <div
                className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] py-1 shadow-lg"
              >
                {realEntries.map((t) => {
                  // t.key and t.href are defined here (filtered above)
                  const href = t.href as string;
                  const itemActive = isPathActive(href);
                  return (
                    <Link
                      key={href}
                      href={`${href}${filterQs}`}
                      className={`mx-1 block rounded-md px-3 py-2 text-sm hover:bg-[var(--page-plane)] ${
                        itemActive
                          ? "text-[var(--series-1)] font-medium"
                          : "text-[var(--text-primary)]"
                      }`}
                    >
                      {t.label}
                    </Link>
                  );
                })}

                {todoEntries.length > 0 && (
                  <>
                    {realEntries.length > 0 && (
                      <div className="mx-3 my-1 border-t border-[var(--border)]" />
                    )}
                    {todoEntries.map((t, i) => (
                      <span
                        key={`todo-${t.label}-${i}`}
                        className="mx-1 flex items-center justify-between rounded-md px-3 py-2 text-sm text-[var(--text-muted)] cursor-default"
                      >
                        {t.label}
                        <span className="ml-2 rounded px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-700">
                          Em breve
                        </span>
                      </span>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {isAdmin && (
        <Link
          href="/dashboard/admin"
          className={`border-b-2 px-3 py-2 text-sm ${
            pathname === "/dashboard/admin" || pathname.startsWith("/dashboard/admin/")
              ? "border-[var(--series-1)] text-[var(--text-primary)]"
              : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          Admin
        </Link>
      )}
    </nav>
  );
}
