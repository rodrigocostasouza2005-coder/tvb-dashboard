import { getSessionUser } from "@/lib/auth";
import { getStores, getMarcas, getTabelasPreco, getSugestoesDeContato } from "@/lib/metrics";
import { getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { waHref } from "@/lib/whatsapp";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";

const MOTIVO_COR: Record<string, string> = {
  "VIP esfriando": "var(--series-1)",
  "Recorrente esfriando": "var(--status-warning)",
  "Aniversário": "var(--status-good)",
};

export default async function ClientesSugestoesContatoPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "clientes-sugestoes-contato");

  const allowedStores = getStoreRestriction(user);
  const allowedMarcas = getMarcaRestriction(user);
  const allowedTabelasPreco = getTabelaPrecoRestriction(user);
  const rawParams = await searchParams;
  const filtrosOpen = rawParams.filtros === "1";
  const filters = parseFilters(rawParams, {
    allowedStoreIds: allowedStores,
    allowedMarcas,
    allowedTabelasPreco,
  });

  const [stores, marcas, tabelasPreco, sugestoes] = await Promise.all([
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getSugestoesDeContato(filters),
  ]);

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/clientes-sugestoes-contato"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          showTabelaPreco
          showDate={false}
          filters={filters}
        />
      </CollapsibleFilters>

      <p className="mb-4 text-sm text-[var(--text-secondary)]">
        Lista curta pra hoje — clientes VIP/Recorrentes esfriando (70-90 dias sem comprar, ainda dá tempo de reter) e aniversariantes do mês. Clica no telefone pra chamar no WhatsApp.
      </p>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Contato</th>
              <th className="px-4 py-2 font-medium">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {sugestoes.map((s, i) => (
              <tr key={`${s.cliente}-${i}`} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                <td className="px-4 py-2 font-medium">{s.cliente}</td>
                <td className="px-4 py-2">
                  {s.telefone ? (
                    <a href={waHref(s.telefone)} target="_blank" rel="noopener noreferrer" className="text-[var(--series-1)] hover:underline tabular-nums">{s.telefone}</a>
                  ) : (
                    <span className="text-[var(--text-muted)]">—</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: MOTIVO_COR[s.motivo] ?? "var(--text-muted)" }} />
                    <span className="text-[var(--text-primary)]">{s.motivo}</span>
                    <span className="text-[var(--text-muted)]">— {s.detalhe}</span>
                  </span>
                </td>
              </tr>
            ))}
            {sugestoes.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Nenhuma sugestão hoje pro filtro selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
