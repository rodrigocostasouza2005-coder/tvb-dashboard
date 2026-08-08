import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import {
  getMinimumRules,
  getRawStores,
  getDistinctColecoes,
  getDistinctGrupos,
  getTamanhosPorGrupo,
} from "@/lib/metrics";
import { requireTabAccess } from "@/lib/tabs";
import { NovaRegraForm } from "./nova-regra-form";
import { RulesTable } from "./rules-table";

export default async function EstoqueMinimoPage() {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "estoque-minimo");
  if (user.role === "VENDEDOR") redirect("/dashboard");

  const [rules, stores, colecoes, grupos, tamanhosPorGrupo] = await Promise.all([
    getMinimumRules(),
    getRawStores(),
    getDistinctColecoes(),
    getDistinctGrupos(),
    getTamanhosPorGrupo(),
  ]);
  const existingRules = rules.map((r) => ({
    storeId: r.storeId,
    grupo: r.grupo,
    tamanho: r.tamanho,
    colecao: r.colecao,
    valorMinimo: r.valorMinimo,
  }));

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
        <NovaRegraForm
          stores={stores}
          colecoes={colecoes}
          grupos={grupos}
          tamanhosPorGrupo={tamanhosPorGrupo}
          existingRules={existingRules}
        />
      </section>

      <RulesTable
        rows={rules.map((r) => ({
          id: r.id,
          storeName: r.store.name,
          grupo: r.grupo,
          tamanho: r.tamanho,
          colecao: r.colecao,
          valorMinimo: r.valorMinimo,
        }))}
      />
    </div>
  );
}
