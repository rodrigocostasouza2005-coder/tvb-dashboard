import { getSessionUser } from "@/lib/auth";
import { getStores, getSugestoesRetiradaEstoque, type SugestaoRetirada } from "@/lib/metrics";
import { getGrupoRestriction, getStoreRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";

function agruparPorLoja(itens: SugestaoRetirada[]): [string, SugestaoRetirada[]][] {
  const grupos = new Map<string, SugestaoRetirada[]>();
  for (const item of itens) {
    const arr = grupos.get(item.loja) ?? [];
    arr.push(item);
    grupos.set(item.loja, arr);
  }
  return [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function TabelaRetirada({ loja, itens }: { loja: string; itens: SugestaoRetirada[] }) {
  const storeId = itens[0].storeId;
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--gridline)] px-4 py-2.5">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          {loja} <span className="font-normal text-[var(--text-muted)]">({itens.length})</span>
        </h3>
        <a
          href={`/api/export/estoque-retirada?store=${storeId}`}
          className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
        >
          Exportar Excel
        </a>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Produto</th>
            <th className="px-4 py-2 font-medium">Grupo</th>
            <th className="px-4 py-2 font-medium">Grade</th>
            <th className="px-4 py-2 font-medium">Sobrou</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((s) => (
            <tr key={`${s.storeId}-${s.produto}`} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
              <td className="px-4 py-2 font-medium">{s.produto}</td>
              <td className="px-4 py-2 text-[var(--text-secondary)]">{s.grupo}</td>
              <td className="px-4 py-2">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ backgroundColor: "color-mix(in srgb, var(--status-critical) 15%, transparent)", color: "var(--status-critical)" }}
                  >
                    {s.pctQuebrada.toFixed(0)}% quebrada
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    ({s.tamanhosZerados}/{s.tamanhosTotal} tamanhos zerados)
                  </span>
                </span>
              </td>
              <td className="px-4 py-2 text-xs text-[var(--text-secondary)]">
                {s.tamanhosComEstoque.map((t) => `${t.tamanho} (${t.quantidade})`).join(", ")}
                <span className="ml-1.5 tabular-nums text-[var(--text-muted)]">— {s.estoqueRestante} un.</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function EstoqueRetiradaPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "estoque-retirada");

  const allowedStores = getStoreRestriction(user);
  const grupoIn = await getGrupoRestriction(user.role);
  const rawParams = await searchParams;
  const filtrosOpen = rawParams.filtros === "1";
  const filters = {
    ...parseFilters(rawParams, { allowedStoreIds: allowedStores }),
    grupoIn,
  };

  const [storesTodas, sugestoes] = await Promise.all([
    getStores(allowedStores),
    getSugestoesRetiradaEstoque({ storeIds: filters.storeIds, grupoIn: filters.grupoIn }),
  ]);

  const porLoja = agruparPorLoja(sugestoes);
  const totalUnidades = sugestoes.reduce((s, r) => s + r.estoqueRestante, 0);
  // "Retirar da loja" é sobre espaço físico de prateleira — não faz sentido pro CD/Site e
  // Atacado, então nem oferece ele no filtro de loja dessa aba (2026-09-02).
  const stores = storesTodas.filter((s) => s.name !== "TVB Site e Atacado");

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/estoque-retirada"
          stores={stores}
          marcas={[]}
          showMarca={false}
          showDate={false}
          filters={filters}
        />
      </CollapsibleFilters>

      <p className="mb-4 text-sm text-[var(--text-secondary)]">
        Produtos com 60% ou mais dos tamanhos zerados na loja (grade quebrada) — sobrou pouca
        coisa espalhada, dificulta vender e ocupa espaço. Sugestão de retirar o que sobrou dessa
        loja. Compara só o estoque da própria loja, não com outras lojas nem com o CD.
        {sugestoes.length > 0 && (
          <span className="ml-1 font-medium text-[var(--text-primary)]">
            {sugestoes.length} produto{sugestoes.length > 1 ? "s" : ""} sinalizado{sugestoes.length > 1 ? "s" : ""},
            somando {totalUnidades} unidades.
          </span>
        )}
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {porLoja.map(([loja, itens]) => (
          <TabelaRetirada key={loja} loja={loja} itens={itens} />
        ))}
        {porLoja.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">Nenhum produto com grade quebrada pro filtro selecionado.</p>
        )}
      </div>
    </div>
  );
}
