import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TABS, defaultAllowedTabs } from "@/lib/tabs";
import { createUserAction, updateUserAction, resetPasswordAction, deleteUserAction } from "./actions";

const ROLES = ["ADMIN", "GESTAO", "VENDEDOR"] as const;

function TabCheckboxes({ name, checked }: { name: string; checked: Set<string> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {TABS.map((t) => (
        <label key={t.key} className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            name={name}
            value={t.key}
            defaultChecked={checked.has(t.key)}
            className="accent-[var(--series-1)]"
          />
          {t.label}
        </label>
      ))}
    </div>
  );
}

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) return null;
  if (user.role !== "ADMIN") redirect("/dashboard");

  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Administração</h1>
      <p className="mb-6 text-sm text-[var(--text-muted)]">
        Crie logins e escolha quais abas cada pessoa pode ver. Deixar todas as caixinhas
        desmarcadas usa o padrão do papel (Admin/Gestão veem tudo, Vendedor não vê Clientes).
      </p>

      <section className="mb-8 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Novo usuário</h2>
        <form action={createUserAction} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <input
              name="name"
              placeholder="Nome"
              required
              className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]"
              style={{ colorScheme: "light dark" }}
            />
            <input
              name="email"
              type="email"
              placeholder="email@tvbshorts.com"
              required
              className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]"
              style={{ colorScheme: "light dark" }}
            />
            <input
              name="password"
              type="text"
              placeholder="Senha inicial"
              required
              className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]"
              style={{ colorScheme: "light dark" }}
            />
            <select
              name="role"
              defaultValue="VENDEDOR"
              className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]"
              style={{ colorScheme: "light dark" }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <TabCheckboxes name="tab" checked={new Set()} />
          <button
            type="submit"
            className="w-fit rounded-md bg-[var(--series-1)] px-3 py-1.5 text-sm font-medium text-white"
          >
            Criar usuário
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-4">
        {users.map((u) => {
          const effectiveTabs = new Set(u.allowedTabs.length > 0 ? u.allowedTabs : defaultAllowedTabs(u.role));
          return (
            <div key={u.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{u.name}</div>
                  <div className="text-xs text-[var(--text-muted)]">{u.email}</div>
                </div>
                {u.id !== user.id && (
                  <form action={deleteUserAction}>
                    <input type="hidden" name="userId" value={u.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                      style={{ color: "var(--status-critical)" }}
                    >
                      Excluir
                    </button>
                  </form>
                )}
              </div>

              <form action={updateUserAction} className="flex flex-col gap-3">
                <input type="hidden" name="userId" value={u.id} />
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor={`role-${u.id}`}>
                    Papel
                  </label>
                  <select
                    id={`role-${u.id}`}
                    name="role"
                    defaultValue={u.role}
                    className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]"
                    style={{ colorScheme: "light dark" }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <TabCheckboxes name="tab" checked={effectiveTabs} />
                <button
                  type="submit"
                  className="w-fit rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
                >
                  Salvar
                </button>
              </form>

              <form action={resetPasswordAction} className="mt-3 flex items-center gap-2 border-t border-[var(--gridline)] pt-3">
                <input type="hidden" name="userId" value={u.id} />
                <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor={`pass-${u.id}`}>
                  Nova senha
                </label>
                <input
                  id={`pass-${u.id}`}
                  name="password"
                  type="text"
                  placeholder="Nova senha"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]"
                  style={{ colorScheme: "light dark" }}
                />
                <button
                  type="submit"
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
                >
                  Trocar senha
                </button>
              </form>
            </div>
          );
        })}
      </section>
    </div>
  );
}
