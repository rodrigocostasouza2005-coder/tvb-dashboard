import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getMinimumRules, getRawStores, getColecaoGrupoTamanhoCombos } from "@/lib/metrics";
import { requireTabAccess } from "@/lib/tabs";
import { deleteMinimumRuleAction } from "./actions";
import { NovaRegraForm } from "./nova-regra-form";

export default async function EstoqueMinimoPage() {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "estoque-minimo");
  if (user.role === "VENDEDOR") redirect("/dashboard");

  const [rules, stores, combos] = await Promise.all([
    getMinimumRules(),
    getRawStores(),
    getColecaoGrupoTamanhoCombos(),
  ]);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Estoque mínimo</h1>
      <p className="mb-6 text-sm text-[var(--text-muted)]">
        Define aqui o mínimo por loja + grupo + tamanho (e opcionalmente por coleção — regra
        com coleção específica tem prioridade sobre uma genérica). Isso substitui o valor que
        vem do DAPIC na aba Reposição de Lojas.
      </p>

      <section className="mb-8 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Nova regra</h2>
        <NovaRegraForm stores={stores} combos={combos} />
      </section>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Loja</th>
              <th className="px-4 py-2 font-medium">Grupo</th>
              <th className="px-4 py-2 font-medium">Tamanho</th>
              <th className="px-4 py-2 font-medium">Coleção</th>
              <th className="px-4 py-2 font-medium">Mínimo</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-b border-[var(--gridline)] last:border-0">
                <td className="px-4 py-2">{r.store.name}</td>
                <td className="px-4 py-2 font-medium">{r.grupo}</td>
                <td className="px-4 py-2">{r.tamanho}</td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{r.colecao ?? "todas"}</td>
                <td className="px-4 py-2 tabular-nums">{r.valorMinimo}</td>
                <td className="px-4 py-2">
                  <form action={deleteMinimumRuleAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                      style={{ color: "var(--status-critical)" }}
                    >
                      Excluir
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Nenhuma regra manual ainda — a Reposição usa o mínimo que vem do DAPIC.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
