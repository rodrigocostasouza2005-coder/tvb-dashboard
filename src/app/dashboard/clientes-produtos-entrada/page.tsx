import { getSessionUser } from "@/lib/auth";
import { getStores, getMarcas, getTabelasPreco, getProdutosPortaDeEntrada, type Canal } from "@/lib/metrics";
import { canSeeFinancials, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function ClientesProdutosEntradaPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "clientes-produtos-entrada");

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
  const canal: Canal = rawParams.canal === "b2b" || rawParams.canal === "b2c" ? rawParams.canal : "todos";

  const [stores, marcas, tabelasPreco, entrada] = await Promise.all([
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getProdutosPortaDeEntrada(filters, canal),
  ]);
  const showFinancials = canSeeFinancials(user);

  function canalHref(c: Canal) {
    const p = new URLSearchParams();
    for (const id of filters.storeIds ?? []) p.append("store", id);
    for (const m of filters.marcas ?? []) p.append("marca", m);
    for (const t of filters.tabelasPreco ?? []) p.append("tabelaPreco", t);
    p.set("canal", c);
    return `/dashboard/clientes-produtos-entrada?${p.toString()}`;
  }

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/clientes-produtos-entrada"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          showTabelaPreco
          filters={filters}
        />
      </CollapsibleFilters>

      <div className="mb-4 flex gap-1">
        {([
          { value: "todos", label: "Todos" },
          { value: "b2b", label: "B2B (atacado)" },
          { value: "b2c", label: "B2C (varejo)" },
        ] as const).map((opt) => (
          <a
            key={opt.value}
            href={canalHref(opt.value)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              canal === opt.value
                ? "border-[var(--series-1)] bg-[var(--series-1)] text-white"
                : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
            }`}
          >
            {opt.label}
          </a>
        ))}
      </div>

      <p className="mb-4 text-xs text-[var(--text-muted)]">
        Quais produtos mais trazem cliente novo pra dentro — não é "o que mais vende". A 1ª compra de cada cliente é sempre olhada no histórico completo (mesmo critério de "cliente novo" do resto do CRM); loja/marca/tabela/canal/período só decidem se aquela 1ª compra entra no ranking. Valores brutos — devolução depois não desfaz a aquisição.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="border-b border-[var(--gridline)] px-4 py-2.5">
            <h2 className="text-sm font-medium text-[var(--text-primary)]">Produto da 1ª compra</h2>
            <p className="text-xs text-[var(--text-muted)]">Ranqueado por quantos clientes trouxe (independente de terem voltado a comprar depois).</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Produto</th>
                <th className="px-4 py-2 font-medium">Clientes</th>
                <th className="px-4 py-2 font-medium">Unidades</th>
                {showFinancials && <th className="px-4 py-2 font-medium">Receita</th>}
              </tr>
            </thead>
            <tbody>
              {entrada.primeiraCompra.map((p) => (
                <tr key={p.produto} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{p.produto}</td>
                  <td className="px-4 py-2 tabular-nums">{p.clientes.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">{p.unidades.toLocaleString("pt-BR")}</td>
                  {showFinancials && <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">{formatBRL(p.receita)}</td>}
                </tr>
              ))}
              {entrada.primeiraCompra.length === 0 && (
                <tr>
                  <td colSpan={showFinancials ? 4 : 3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Nenhum dado no filtro/período selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="border-b border-[var(--gridline)] px-4 py-2.5">
            <h2 className="text-sm font-medium text-[var(--text-primary)]">Produto de clientes que só compraram 1 vez</h2>
            <p className="text-xs text-[var(--text-muted)]">Recorte de clientes com 1 pedido na vida toda (nunca voltaram) — a 1ª compra deles é também a única.</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Produto</th>
                <th className="px-4 py-2 font-medium">Clientes</th>
                <th className="px-4 py-2 font-medium">Unidades</th>
                {showFinancials && <th className="px-4 py-2 font-medium">Receita</th>}
              </tr>
            </thead>
            <tbody>
              {entrada.compradorUnico.map((p) => (
                <tr key={p.produto} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium text-[var(--text-primary)]">{p.produto}</td>
                  <td className="px-4 py-2 tabular-nums">{p.clientes.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">{p.unidades.toLocaleString("pt-BR")}</td>
                  {showFinancials && <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">{formatBRL(p.receita)}</td>}
                </tr>
              ))}
              {entrada.compradorUnico.length === 0 && (
                <tr>
                  <td colSpan={showFinancials ? 4 : 3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Nenhum dado no filtro/período selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
