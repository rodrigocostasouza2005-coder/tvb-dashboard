import { getSessionUser } from "@/lib/auth";
import { getStores, getMarcas, getTabelasPreco, getClienteFicha } from "@/lib/metrics";
import { canSeeFinancials, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { StatTile } from "../stat-tile";

const PRECO_LABEL: Record<string, string> = {
  full_price: "Preço cheio",
  promo_driven: "Guiado por promoção",
  mixed: "Misto",
  sem_dado: "Sem dado suficiente",
};

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDataNascimento(d: Date | null) {
  if (!d) return null;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

function formatData(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

export default async function ClientesFichaPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "clientes-ficha");

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
  const clienteNome = typeof rawParams.cliente === "string" && rawParams.cliente ? rawParams.cliente : null;

  const [stores, marcas, tabelasPreco, ficha] = await Promise.all([
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    clienteNome ? getClienteFicha(filters, clienteNome) : Promise.resolve(null),
  ]);
  const showFinancials = canSeeFinancials(user);

  return (
    <div>
      <CollapsibleFilters defaultOpen={filtrosOpen}>
        <FilterBar
          action="/dashboard/clientes-ficha"
          stores={stores}
          marcas={marcas}
          tabelasPreco={tabelasPreco}
          showTabelaPreco
          showDate={false}
          filters={filters}
        />
      </CollapsibleFilters>

      <form method="get" action="/dashboard/clientes-ficha" className="mb-6 flex gap-2">
        {filters.storeIds?.map((id) => <input key={id} type="hidden" name="store" value={id} />)}
        {filters.marcas?.map((m) => <input key={m} type="hidden" name="marca" value={m} />)}
        {filters.tabelasPreco?.map((t) => <input key={t} type="hidden" name="tabelaPreco" value={t} />)}
        <input
          type="text"
          name="cliente"
          defaultValue={clienteNome ?? ""}
          placeholder="Nome exato do cliente ou CPF/CNPJ..."
          className="w-full max-w-sm rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--series-1)]"
          style={{ colorScheme: "light dark" }}
        />
        <button type="submit" className="rounded-md bg-[var(--series-1)] px-4 py-1.5 text-sm font-medium text-white">
          Ver ficha
        </button>
      </form>

      {!clienteNome && (
        <p className="text-sm text-[var(--text-muted)]">Digite o nome exato ou o CPF/CNPJ de um cliente pra ver a ficha (encontre o nome exato na aba Visão Geral, Segmentação ou Produto → Cliente).</p>
      )}
      {clienteNome && !ficha && (
        <p className="text-sm text-[var(--text-muted)]">Cliente não encontrado (confira o nome exato ou o CPF/CNPJ).</p>
      )}

      {ficha && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{ficha.cliente}</h2>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--text-secondary)]">
                {ficha.telefone && (
                  <a href={`tel:${ficha.telefone}`} className="text-[var(--series-1)] hover:underline tabular-nums">{ficha.telefone}</a>
                )}
                {ficha.email && <span>{ficha.email}</span>}
                {ficha.dataNascimento && <span>Nasc. {formatDataNascimento(ficha.dataNascimento)}</span>}
                {ficha.cpfCnpj && <span>{ficha.cpfCnpj}</span>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
                <span>1ª compra: {formatData(ficha.primeiraCompra)}</span>
                <span>Última compra: {formatData(ficha.ultimaCompra)}</span>
              </div>
            </div>
            <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
              {PRECO_LABEL[ficha.comportamentoPreco]}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {showFinancials && <StatTile label="Receita líquida" value={formatBRL(ficha.receitaLiquida)} subValue={`Bruta: ${formatBRL(ficha.receitaBruta)}`} />}
            <StatTile label="Unidades líquidas" value={ficha.unidadesLiquidas.toLocaleString("pt-BR")} subValue={`Brutas: ${ficha.unidadesBrutas.toLocaleString("pt-BR")}`} />
            <StatTile label="Pedidos" value={ficha.pedidos.toLocaleString("pt-BR")} subValue={`B2B ${ficha.pedidosB2B} · B2C ${ficha.pedidosB2C}`} />
            {showFinancials && <StatTile label="Ticket médio (líquido)" value={formatBRL(ficha.ticketMedio)} />}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
              <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Grupos comprados (líquido)</h3>
              <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto text-sm">
                {ficha.topGrupos.map((g) => (
                  <li key={g.grupo} className="flex items-center justify-between gap-2">
                    <span className="truncate text-[var(--text-primary)]">{g.grupo}</span>
                    <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{g.unidadesLiquidas} un.</span>
                  </li>
                ))}
                {ficha.topGrupos.length === 0 && <li className="text-[var(--text-muted)]">—</li>}
              </ul>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
              <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Todos os produtos comprados (líquido)</h3>
              <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto text-sm">
                {ficha.topProdutos.map((p) => (
                  <li key={p.produto} className="flex items-center justify-between gap-2">
                    <span className="truncate text-[var(--text-primary)]">{p.produto}</span>
                    <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{p.unidadesLiquidas} un.</span>
                  </li>
                ))}
                {ficha.topProdutos.length === 0 && <li className="text-[var(--text-muted)]">—</li>}
              </ul>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
              <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Onde comprou (pedidos)</h3>
              <ul className="flex flex-wrap gap-1.5">
                {ficha.topLojas.map((l) => (
                  <li key={l.loja} className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)]">
                    {l.loja} <span className="text-[var(--text-muted)]">({l.pedidos} {l.pedidos === 1 ? "pedido" : "pedidos"})</span>
                  </li>
                ))}
                {ficha.topLojas.length === 0 && <li className="text-[var(--text-muted)]">—</li>}
              </ul>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
              <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">Tamanhos mais comprados (líquido)</h3>
              <ul className="flex flex-wrap gap-1.5">
                {ficha.topTamanhos.map((t) => (
                  <li key={t.tamanho} className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)]">
                    {t.tamanho} <span className="text-[var(--text-muted)]">({t.unidades})</span>
                  </li>
                ))}
                {ficha.topTamanhos.length === 0 && <li className="text-[var(--text-muted)]">—</li>}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
