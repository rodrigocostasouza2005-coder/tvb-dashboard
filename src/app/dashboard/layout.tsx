import { redirect } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";
import Image from "next/image";
import { getSessionUser } from "@/lib/auth";
import { scheduleCatchupSyncIfStale } from "@/lib/self-heal-sync";
import { logoutAction } from "./actions";
import { TabNav } from "./tab-nav";
import { TABS, defaultAllowedTabs } from "@/lib/tabs";
import { PhoneModeProvider, PhoneModeToggle } from "./phone-mode";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Best-effort: se o cron da Vercel falhar (ex: deploy em cima do horário), quem abrir o
  // dashboard dispara a sync sozinho — depois de responder a página, não trava a navegação.
  after(() => scheduleCatchupSyncIfStale());

  const allowed = user.allowedTabs.length > 0 ? user.allowedTabs : defaultAllowedTabs(user.role);
  const visibleKeys = TABS.filter(
    (t): t is Extract<typeof t, { key: NonNullable<(typeof t)["key"]> }> =>
      t.key !== undefined && allowed.includes(t.key)
  ).map((t) => t.key);

  return (
    <PhoneModeProvider>
      <div className="min-h-screen bg-[var(--page-plane)] text-[var(--text-primary)]">
        <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface-1)]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-y-2 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-white p-0.5 leading-[0]">
                <Image src="/tvb-logo.png" alt="TVB Shorts" width={28} height={22} className="rounded-sm" />
              </div>
              <div>
                <div className="text-sm font-semibold">TVB Radar</div>
                {/* Subtítulo só do tablet pra cima — em celular estreito ele e o resto do
                    cabeçalho (toggle + nome + Sair) não cabiam numa linha só e ficavam
                    espremidos/cortados (achado pelo Rodrigo em 2026-09-18). */}
                <div className="hidden text-xs text-[var(--text-muted)] sm:block">TVB Shorts · Painel TVB Radar</div>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              {/* Formato de exibição de telefone (Celular/Computador) — global, vale pra
                  qualquer aba que mostre contato de cliente. Ver phone-mode.tsx. */}
              <PhoneModeToggle compact />
              <span className="hidden text-xs text-[var(--text-secondary)] sm:inline">
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
          <Suspense fallback={<nav className="mx-auto flex max-w-7xl flex-wrap gap-1 px-4 sm:px-6" />}>
            <TabNav visibleKeys={visibleKeys} isAdmin={user.role === "ADMIN"} />
          </Suspense>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </PhoneModeProvider>
  );
}
