import { getSessionUser } from "@/lib/auth";
import { getStores, getMarcas, getTabelasPreco, getClienteSegmentacao, type Canal, type ClienteSegmento } from "@/lib/metrics";
import { canSeeFinancials, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";

const SEGMENTO_ORDER: ClienteSegmento[] = ["vip", "recorrente", "em_risco", "novo", "ocasional", "inativo"];
const SEGMENTO_LABEL: Record<ClienteSegmento, string> = {
  vip: "VIP",
  recorrente: "Recorrentes",
  em_risco: "Em risco",
  novo: "Novos",
  ocasional: "Ocasionais",
  inativo: "Inativos",
};
const SEGMENTO_COR: Record<ClienteSegmento, string> = {
  vip: "var(--series-1)",
  recorrente: "var(--status-good)",
  em_risco: "var(--status-warning)",
  novo: "var(--cat-3)",
  ocasional: "var(--text-muted)",
  inativo: "var(--status-critical)",
};

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function ClientesSegmentacaoPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "clientes-segmentacao");

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
  const segmentoSelecionado = typeof rawParams.segmento === "string" ? (rawParams.segmento as ClienteSegmento) : null;

  const [stores, marcas, tabelasPreco, segmentacao] = await Promise.all([
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getClienteSegmentacao(filters, canal),
  ]);
  const showFinancials = canSeeFinancials(user);

  const segmentoCounts = new Map<ClienteSegmento, { count: number; receita: number }>();
  for (const s of segmentacao) {
    const cur = segmentoCounts.get(s.segmento) ?? { count: 0, receita: 0 };
    cur.count++;
    cur.receita += s.receitaBruta;
    segmentoCounts.set(s.segmento, cur);
  }
  const listaSegmento = segmentoSelecionado
    ? segmentacao
        .filter((s) => s.segmento === segmentoSelecionado)
        .sort((a, b) => b.receitaBruta - a.receitaBruta)
        .slice(0, 100)
    : [];

  function baseParams() {
    const p = new URLSearchParams();
    for (const id of filters.storeIds ?? []) p.append("store", id);
    for (const m of filters.marcas ?? []) p.append("marca", m);
    for (const t of filters.tabelasPreco ?? []) p.append("tabelaPreco", t);
    p.set("canal", canal);
    return p;
  }
  function segmentoHref(seg: ClienteSegmento) {
    const p = baseParams();
    p.set("segmento", seg);
    return `/dashboard/clientes-segmentacao?${p.toString()}`;
  }
  function canalHref(c: Canal) {
    const p = baseParams();
    p.set("canal", c);
    if (segmentoSelecionado) p.set("segmento", segmentoSelecionado);
    return `/dashboard/clientes-segmentacao?${p.toString()}`;
  }
  function clienteHref(nome: string) {
    const p = baseParams();
    p.delete("canal");
    p.set("cliente", nome);
    return `/dashboard/clientes-ficha?${p.toString()}`;
  }

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/clientes-segmentacao"
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
        Baseado no histórico completo do cliente (não só no período do filtro acima) — loja/marca/tabela/canal continuam aplicados.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {SEGMENTO_ORDER.map((seg) => {
          const c = segmentoCounts.get(seg) ?? { count: 0, receita: 0 };
          return (
            <a
              key={seg}
              href={segmentoHref(seg)}
              className={`rounded-lg border p-3 text-left transition-colors hover:bg-[var(--page-plane)] ${
                segmentoSelecionado === seg ? "border-[var(--series-1)]" : "border-[var(--border)]"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: SEGMENTO_COR[seg] }} />
                <span className="text-xs font-medium text-[var(--text-secondary)]">{SEGMENTO_LABEL[seg]}</span>
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--text-primary)]">{c.count}</div>
              {showFinancials && (
                <div className="mt-0.5 text-xs tabular-nums text-[var(--text-muted)]">{formatBRL(c.receita)}</div>
              )}
            </a>
          );
        })}
      </div>

      {segmentoSelecionado && (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Cliente ({SEGMENTO_LABEL[segmentoSelecionado]})</th>
                <th className="px-4 py-2 font-medium">Contato</th>
                <th className="px-4 py-2 font-medium">Grupo mais comprado</th>
                <th className="px-4 py-2 font-medium">Pedidos</th>
                <th className="px-4 py-2 font-medium">Última compra</th>
                {showFinancials && <th className="px-4 py-2 font-medium">Receita bruta</th>}
              </tr>
            </thead>
            <tbody>
              {listaSegmento.map((s) => (
                <tr key={s.cliente} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium">
                    <a href={clienteHref(s.cliente)} className="hover:underline">{s.cliente}</a>
                  </td>
                  <td className="px-4 py-2">
                    {s.telefone ? (
                      <a href={`tel:${s.telefone}`} className="text-[var(--series-1)] hover:underline tabular-nums">{s.telefone}</a>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-[var(--text-secondary)]">{s.grupoPrincipal ?? <span className="text-[var(--text-muted)]">—</span>}</td>
                  <td className="px-4 py-2 tabular-nums">{s.pedidos}</td>
                  <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">há {s.recenciaDias}d</td>
                  {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(s.receitaBruta)}</td>}
                </tr>
              ))}
              {listaSegmento.length === 0 && (
                <tr>
                  <td colSpan={showFinancials ? 6 : 5} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Nenhum cliente nesse segmento.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
