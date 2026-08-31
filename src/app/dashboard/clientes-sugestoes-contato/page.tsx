import { getSessionUser } from "@/lib/auth";
import { getStores, getMarcas, getTabelasPreco, getSugestoesDeContato, getFollowUpPosCompra, type SugestaoContato, type FollowUpPosCompra } from "@/lib/metrics";
import { getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { waHref } from "@/lib/whatsapp";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";

const MOTIVO_COR: Record<string, string> = {
  "VIP esfriando": "var(--series-1)",
  "Recorrente esfriando": "var(--status-warning)",
  "Em risco": "var(--status-serious)",
  "Comprou só 1 vez": "var(--cat-3)",
  "Inativo": "var(--status-critical)",
  "Aniversário": "var(--status-good)",
};

const SEM_LOJA = "Sem loja identificada";

function agruparPorLoja<T extends { loja: string | null }>(itens: T[]): [string, T[]][] {
  const grupos = new Map<string, T[]>();
  for (const item of itens) {
    const key = item.loja ?? SEM_LOJA;
    const arr = grupos.get(key) ?? [];
    arr.push(item);
    grupos.set(key, arr);
  }
  return [...grupos.entries()].sort(([a], [b]) => (a === SEM_LOJA ? 1 : b === SEM_LOJA ? -1 : a.localeCompare(b)));
}

function TabelaSugestoes({ loja, sugestoes }: { loja: string; sugestoes: SugestaoContato[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <h3 className="border-b border-[var(--gridline)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)]">{loja} <span className="font-normal text-[var(--text-muted)]">({sugestoes.length})</span></h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Cliente</th>
            <th className="px-4 py-2 font-medium">Contato</th>
            <th className="px-4 py-2 font-medium">Motivo</th>
            <th className="px-4 py-2 font-medium">Produto favorito</th>
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
              <td className="px-4 py-2 text-[var(--text-secondary)]">{s.produtoFavorito ?? <span className="text-[var(--text-muted)]">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelaFollowUp({ loja, itens }: { loja: string; itens: FollowUpPosCompra[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <h3 className="border-b border-[var(--gridline)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)]">{loja} <span className="font-normal text-[var(--text-muted)]">({itens.length})</span></h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Cliente</th>
            <th className="px-4 py-2 font-medium">Contato</th>
            <th className="px-4 py-2 font-medium">Produto(s) comprado(s)</th>
            <th className="px-4 py-2 font-medium">Há quantos dias</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((f) => (
            <tr key={f.cliente} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
              <td className="px-4 py-2 font-medium">{f.cliente}</td>
              <td className="px-4 py-2">
                {f.telefone ? (
                  <a href={waHref(f.telefone)} target="_blank" rel="noopener noreferrer" className="text-[var(--series-1)] hover:underline tabular-nums">{f.telefone}</a>
                ) : (
                  <span className="text-[var(--text-muted)]">—</span>
                )}
              </td>
              <td className="px-4 py-2 text-[var(--text-secondary)]">{f.produtos.join(", ")}</td>
              <td className="px-4 py-2 tabular-nums">{f.diasAtras}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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

  const [stores, marcas, tabelasPreco, sugestoes, followUp] = await Promise.all([
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getSugestoesDeContato(filters),
    getFollowUpPosCompra(filters),
  ]);

  const sugestoesPorLoja = agruparPorLoja(sugestoes);
  const followUpPorLoja = agruparPorLoja(followUp);

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
        Lista muda todo dia — só clientes B2C (varejo), com um pouco de cada grupo (VIP esfriando, Recorrente esfriando, Em risco, Comprou só 1x, Inativo, Aniversário), separada pela loja principal de cada cliente.
      </p>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {sugestoesPorLoja.map(([loja, itens]) => (
          <TabelaSugestoes key={loja} loja={loja} sugestoes={itens} />
        ))}
        {sugestoesPorLoja.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">Nenhuma sugestão hoje pro filtro selecionado.</p>
        )}
      </div>

      <section>
        <h2 className="mb-1 text-sm font-medium text-[var(--text-secondary)]">Follow-up pós-compra (7-10 dias)</h2>
        <p className="mb-3 text-xs text-[var(--text-muted)]">Clientes B2C que compraram há 7-10 dias — perguntar se gostou e conseguiu aproveitar o produto.</p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {followUpPorLoja.map(([loja, itens]) => (
            <TabelaFollowUp key={loja} loja={loja} itens={itens} />
          ))}
          {followUpPorLoja.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">Nenhuma compra B2C nessa janela de 7-10 dias atrás.</p>
          )}
        </div>
      </section>
    </div>
  );
}
