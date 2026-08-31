import { getSessionUser } from "@/lib/auth";
import { getStores, getMarcas, getTabelasPreco, getSalesByDimension, getClientesPorDimensao, getCrossSellPorDimensao, type Canal } from "@/lib/metrics";
import { canSeeFinancials, getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { waHref } from "@/lib/whatsapp";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { PcKeySelect } from "./pc-key-select";

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function ClientesProdutoPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "clientes-produto");

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
  const pcDim: "produto" | "grupo" = rawParams.pcDim === "produto" ? "produto" : "grupo";
  const pcKeys = Array.isArray(rawParams.pcKey)
    ? rawParams.pcKey
    : typeof rawParams.pcKey === "string" && rawParams.pcKey
      ? [rawParams.pcKey]
      : [];

  const [stores, marcas, tabelasPreco, pcOptions] = await Promise.all([
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getSalesByDimension(filters, pcDim, canal),
  ]);
  const showFinancials = canSeeFinancials(user);
  const [pcResultado, crossSell] = await Promise.all([
    pcKeys.length > 0 ? getClientesPorDimensao(filters, pcDim, pcKeys, canal) : Promise.resolve([]),
    pcKeys.length > 0 ? getCrossSellPorDimensao(filters, pcDim, pcKeys, canal) : Promise.resolve(null),
  ]);

  function baseParams() {
    const p = new URLSearchParams();
    for (const id of filters.storeIds ?? []) p.append("store", id);
    for (const m of filters.marcas ?? []) p.append("marca", m);
    for (const t of filters.tabelasPreco ?? []) p.append("tabelaPreco", t);
    p.set("canal", canal);
    return p;
  }
  function canalHref(c: Canal) {
    const p = baseParams();
    p.set("canal", c);
    p.set("pcDim", pcDim);
    for (const k of pcKeys) p.append("pcKey", k);
    return `/dashboard/clientes-produto?${p.toString()}`;
  }
  function pcDimHref(dim: "produto" | "grupo") {
    const p = baseParams();
    p.set("pcDim", dim);
    return `/dashboard/clientes-produto?${p.toString()}`;
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
          action="/dashboard/clientes-produto"
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

      <h1 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Quem compra esse produto/grupo?</h1>
      <div className="mb-3 flex gap-1">
        <a
          href={pcDimHref("grupo")}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium ${pcDim === "grupo" ? "border-[var(--series-1)] bg-[var(--series-1)] text-white" : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"}`}
        >
          Por grupo
        </a>
        <a
          href={pcDimHref("produto")}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium ${pcDim === "produto" ? "border-[var(--series-1)] bg-[var(--series-1)] text-white" : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"}`}
        >
          Por produto
        </a>
      </div>
      <PcKeySelect
        options={pcOptions.map((o) => o.key)}
        current={pcKeys}
        label={`Selecione um ou mais ${pcDim === "grupo" ? "grupos" : "produtos"}`}
      />

      {pcKeys.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Cliente</th>
                <th className="px-4 py-2 font-medium">Contato</th>
                <th className="px-4 py-2 font-medium">Unidades</th>
                {showFinancials && <th className="px-4 py-2 font-medium">Receita bruta</th>}
              </tr>
            </thead>
            <tbody>
              {pcResultado.map((r) => (
                <tr key={r.cliente} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                  <td className="px-4 py-2 font-medium">
                    <a href={clienteHref(r.cliente)} className="hover:underline">{r.cliente}</a>
                  </td>
                  <td className="px-4 py-2">
                    {r.telefone ? (
                      <a href={waHref(r.telefone)} target="_blank" rel="noopener noreferrer" className="text-[var(--series-1)] hover:underline tabular-nums">{r.telefone}</a>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 tabular-nums">{r.unidades}</td>
                  {showFinancials && <td className="px-4 py-2 tabular-nums">{formatBRL(r.receita)}</td>}
                </tr>
              ))}
              {pcResultado.length === 0 && (
                <tr>
                  <td colSpan={showFinancials ? 4 : 3} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Sem clientes identificados pra {pcDim === "grupo" ? "esses grupos" : "esses produtos"} no período/filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {crossSell && crossSell.resumo.totalClientes > 0 && (
        <div className="mt-6 flex flex-col gap-4">
          <div>
            <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
              O que mais esses clientes compram? <span className="font-normal text-[var(--text-muted)]">(cross-sell, líquido)</span>
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
                <div className="text-xs text-[var(--text-muted)]">Clientes que compraram</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--text-primary)]">{crossSell.resumo.totalClientes.toLocaleString("pt-BR")}</div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
                <div className="text-xs text-[var(--text-muted)]">Unidades (líquidas)</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--text-primary)]">{crossSell.resumo.unidadesLiquidas.toLocaleString("pt-BR")}</div>
                <div className="mt-0.5 text-xs tabular-nums text-[var(--text-muted)]">Brutas: {crossSell.resumo.unidadesBrutas.toLocaleString("pt-BR")}</div>
              </div>
              {showFinancials && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 sm:col-span-2">
                  <div className="text-xs text-[var(--text-muted)]">Receita (líquida)</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--text-primary)]">{formatBRL(crossSell.resumo.receitaLiquida)}</div>
                  <div className="mt-0.5 text-xs tabular-nums text-[var(--text-muted)]">Bruta: {formatBRL(crossSell.resumo.receitaBruta)}</div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
              <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">
                Produtos mais comprados por esses clientes (líquido)
              </h3>
              <ul className="flex max-h-96 flex-col gap-1.5 overflow-y-auto text-sm">
                {crossSell.produtosRelacionados.map((p) => (
                  <li key={p.key} className="flex items-center justify-between gap-2">
                    <span className="truncate text-[var(--text-primary)]">{p.key}</span>
                    <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{p.unidadesLiquidas} un.</span>
                  </li>
                ))}
                {crossSell.produtosRelacionados.length === 0 && (
                  <li className="text-[var(--text-muted)]">
                    {pcDim === "produto" ? "Só compram o produto selecionado." : "Nenhum outro produto identificado."}
                  </li>
                )}
              </ul>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
              <h3 className="mb-2 text-xs font-medium text-[var(--text-muted)]">
                Grupos de produtos mais comprados por esses clientes (líquido)
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {crossSell.gruposRelacionados.map((g) => (
                  <li key={g.key} className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)]">
                    {g.key} <span className="text-[var(--text-muted)]">({g.unidadesLiquidas})</span>
                  </li>
                ))}
                {crossSell.gruposRelacionados.length === 0 && (
                  <li className="text-[var(--text-muted)]">
                    {pcDim === "grupo" ? "Só compram do grupo selecionado." : "Nenhum outro grupo identificado."}
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
