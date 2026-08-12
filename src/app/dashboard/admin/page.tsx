import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRawStores, getMarcas, getTabelasPreco } from "@/lib/metrics";
import { TABS, defaultAllowedTabs } from "@/lib/tabs";
import { createUserAction, updateUserAction, resetPasswordAction, deleteUserAction } from "./actions";
import { ForceSyncButton } from "./force-sync-button";

// A sincronização manual (ForceSyncButton) chama runSync() direto, que pode levar minutos
// (estoque de 4 lojas + faturas) — sem isso a Server Action tomaria timeout no plano padrão.
export const maxDuration = 300;

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

// Vazio = sem restrição, vê todas as lojas (mesmo padrão do TabCheckboxes/allowedTabs).
function StoreCheckboxes({
  name,
  checked,
  stores,
}: {
  name: string;
  checked: Set<string>;
  stores: { id: string; name: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {stores.map((s) => (
        <label key={s.id} className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            name={name}
            value={s.id}
            defaultChecked={checked.has(s.id)}
            className="accent-[var(--series-1)]"
          />
          {s.name}
        </label>
      ))}
    </div>
  );
}

// Mesmo padrão de StoreCheckboxes, genérico pra valor=label (Marca, Tabela de Preço).
function OptionCheckboxes({ name, checked, options }: { name: string; checked: Set<string>; options: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {options.map((o) => (
        <label key={o} className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            name={name}
            value={o}
            defaultChecked={checked.has(o)}
            className="accent-[var(--series-1)]"
          />
          {o}
        </label>
      ))}
    </div>
  );
}

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) return null;
  if (user.role !== "ADMIN") redirect("/dashboard");

  const [users, stores, marcas, tabelasPreco] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    getRawStores(),
    getMarcas(),
    getTabelasPreco(),
  ]);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Administração</h1>
      <p className="mb-6 text-sm text-[var(--text-muted)]">
        Crie logins e escolha quais abas cada pessoa pode ver. Deixar todas as caixinhas
        desmarcadas usa o padrão do papel (Admin/Gestão veem tudo, Vendedor não vê Clientes).
        O mesmo vale pra Loja, Marca e Tabela de Preço: nenhuma marcada = vê tudo. Marcando uma
        ou mais, a pessoa só vê dado daquelas opções em qualquer aba — nem aparece opção de
        escolher outra.
      </p>

      <section className="mb-8 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Sincronização</h2>
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          Roda a mesma sincronização do cron das 8h/17h, na hora. Dispara o aviso no Telegram do
          mesmo jeito.
        </p>
        <ForceSyncButton />
      </section>

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
          <StoreCheckboxes name="store" checked={new Set()} stores={stores} />
          <OptionCheckboxes name="marca" checked={new Set()} options={marcas} />
          <OptionCheckboxes name="tabelaPreco" checked={new Set()} options={tabelasPreco} />
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
                <StoreCheckboxes name="store" checked={new Set(u.allowedStores)} stores={stores} />
                <OptionCheckboxes name="marca" checked={new Set(u.allowedMarcas)} options={marcas} />
                <OptionCheckboxes name="tabelaPreco" checked={new Set(u.allowedTabelasPreco)} options={tabelasPreco} />
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
