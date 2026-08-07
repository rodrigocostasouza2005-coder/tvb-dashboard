import { redirect } from "next/navigation";
import Image from "next/image";
import { getSessionUser } from "@/lib/auth";
import { logoutAction } from "./actions";
import { TabNav } from "./tab-nav";
import { TABS, defaultAllowedTabs } from "@/lib/tabs";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const allowed = user.allowedTabs.length > 0 ? user.allowedTabs : defaultAllowedTabs(user.role);
  const visibleKeys = TABS.filter((t) => allowed.includes(t.key)).map((t) => t.key);

  return (
    <div className="min-h-screen bg-[var(--page-plane)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface-1)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-white p-0.5 leading-[0]">
              <Image src="/tvb-logo.png" alt="TVB Shorts" width={28} height={22} className="rounded-sm" />
            </div>
            <div>
              <div className="text-sm font-semibold">TVB Shorts</div>
              <div className="text-xs text-[var(--text-muted)]">Painel de operação</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-[var(--text-secondary)]">
              {user.name} · {user.role}
            </span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
        <TabNav visibleKeys={visibleKeys} isAdmin={user.role === "ADMIN"} />
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
