import { getSessionUser } from "@/lib/auth";
import { requireTabAccess } from "@/lib/tabs";
import { parsePerformanceFilters } from "@/lib/performance";
import { getContentRecords, getContentById, getDistinctPerfis, getPerformanceSummary } from "@/lib/performance";
import { getRawStores } from "@/lib/metrics";
import { toDateInputValue } from "@/lib/filters";
import { CollapsibleFilters } from "../collapsible-filters";
import { StatTile } from "../stat-tile";
import { PerformanceFilterBar } from "./performance-filter-bar";
import { ContentForm } from "./content-form";
import { ContentTable } from "./content-table";
import type { RawSearchParams } from "@/lib/filters";

function formatPct(v: number | null) {
  return v != null ? `${v.toFixed(1)}%` : "—";
}

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "performance");
  const canEdit = user.role === "ADMIN" || user.role === "GESTAO";

  const rawParams = await searchParams;
  const filtrosOpen = rawParams.filtros === "1";
  const filters = parsePerformanceFilters(rawParams);
  const editId = typeof rawParams.edit === "string" ? rawParams.edit : null;

  const [records, perfis, allStores, summary, editing] = await Promise.all([
    getContentRecords(filters),
    getDistinctPerfis(),
    getRawStores(),
    getPerformanceSummary(filters),
    editId ? getContentById(editId) : Promise.resolve(null),
  ]);
  // Só lojas físicas de venda fazem sentido aqui — conteúdo não é "feito" no CD nem em armazéns.
  const stores = allStores.filter((s) => s.sellsProducts);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Performance</h1>
      <p className="mb-4 text-sm text-[var(--text-muted)]">
        Registro e organização da performance de conteúdo por perfil (stories e posts, qualificados
        e básicos). A classificação é sempre lançada manualmente — não é calculada a partir do
        engajamento. Quem quiser transformar isso em rankings, comparações e gráficos, veja a aba{" "}
        <a href="/dashboard/analise-performance" className="text-[var(--series-1)] hover:underline">
          Análise de Performance
        </a>
        .
      </p>

      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <PerformanceFilterBar action="/dashboard/performance" perfis={perfis} stores={stores} filters={filters} />
      </CollapsibleFilters>

      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Total de conteúdos" value={summary.totalConteudos.toLocaleString("pt-BR")} />
        <StatTile label="Stories" value={summary.stories.toLocaleString("pt-BR")} />
        <StatTile label="Posts" value={summary.posts.toLocaleString("pt-BR")} />
        <StatTile label="Reposts" value={summary.reposts.toLocaleString("pt-BR")} />
        <StatTile label="Visitas" value={summary.visitas.toLocaleString("pt-BR")} />
        <StatTile label="% qualificados" value={formatPct(summary.pctQualificados)} subValue={`${summary.qualificados} de ${summary.totalConteudos}`} />
      </section>

      {canEdit && (
        <section className="mb-8 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
          <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
            {editing ? `Editando registro de ${editing.perfil} (${toDateInputValue(editing.data)})` : "Novo registro"}
          </h2>
          <ContentForm perfis={perfis} stores={stores} editing={editing} />
        </section>
      )}

      <ContentTable
        canEdit={canEdit}
        rows={records.map((r) => ({
          id: r.id,
          perfil: r.perfil,
          tipo: r.tipo,
          classificacao: r.classificacao,
          data: r.data.toISOString(),
          engajamento: r.engajamento,
          observacoes: r.observacoes,
          storeName: r.store?.name ?? null,
        }))}
      />
    </div>
  );
}
