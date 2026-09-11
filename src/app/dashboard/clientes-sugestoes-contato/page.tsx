import { getSessionUser } from "@/lib/auth";
import { getStores, getMarcas, getTabelasPreco, getSugestoesDeContato, getFollowUpPosCompra, type SugestaoContato, type FollowUpPosCompra } from "@/lib/metrics";
import { getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { waHref } from "@/lib/whatsapp";
import { getNumeroNotaFiscal } from "@/lib/connectors/nota-fiscal";
import { prisma } from "@/lib/prisma";
import { getMensagemTemplates, renderTemplate, type TemplateKey } from "@/lib/message-templates";
import { FilterBar } from "../filter-bar";
import { CollapsibleFilters } from "../collapsible-filters";
import { ContatoWhatsappLink } from "./contato-whatsapp-link";

type ContatoInfo = { contatadoPor: string; contatadoEm: string };

const MOTIVO_COR: Record<string, string> = {
  "VIP esfriando": "var(--series-1)",
  "Recorrente esfriando": "var(--status-warning)",
  "Em risco": "var(--status-serious)",
  "Comprou só 1 vez": "var(--cat-3)",
  "Inativo": "var(--status-critical)",
  "Aniversário": "var(--status-good)",
};

const SEM_LOJA = "Sem loja identificada";

function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0];
}

const MOTIVO_TO_TEMPLATE_KEY: Record<string, TemplateKey> = {
  "VIP esfriando": "vip_esfriando",
  "Recorrente esfriando": "recorrente_esfriando",
  "Em risco": "em_risco",
  "Inativo": "inativo",
  "Comprou só 1 vez": "comprou_1_vez",
  "Aniversário": "aniversario",
};

// Gancho de estoque (pedido do Rodrigo em 2026-09-08): quando o tamanho que o cliente mais
// compra do produto favorito dele ainda está disponível na loja principal, entra uma linha a
// mais — só nesse caso (nunca inventa disponibilidade, ver getTamanhoEstoqueParaClientes). Só
// nos 2 motivos "esfriando" — os motivos com cupom (pedido dele em 2026-09-09) não ganham esse
// gancho. Não é texto editável na tela de templates, é sempre acrescentado pelo código.
const MOTIVOS_COM_GANCHO_ESTOQUE = new Set<TemplateKey>(["vip_esfriando", "recorrente_esfriando"]);

// Mensagem pronta por motivo, pré-preenchida no WhatsApp — o texto em si vem de
// MensagemTemplate (editável em /dashboard/marketing-templates, pedido do Rodrigo em
// 2026-09-11), essa função só resolve os placeholders e acrescenta o gancho de estoque quando
// aplicável. Ele ainda revisa/edita antes de mandar (waHref nunca envia sozinho).
function mensagemSugestao(s: SugestaoContato, templates: Record<TemplateKey, string>): string {
  const nome = primeiroNome(s.cliente);
  const key = MOTIVO_TO_TEMPLATE_KEY[s.motivo];
  const texto = key ? templates[key] : "Oi {nome}, tudo bem? Aqui é da TVB Shorts!";
  const base = renderTemplate(texto, { nome, detalhe: s.detalhe });

  if (key && MOTIVOS_COM_GANCHO_ESTOQUE.has(key) && s.tamanhoDisponivel && s.produtoFavorito) {
    return `${base} Inclusive ainda temos o ${s.produtoFavorito} no seu tamanho (${s.tamanhoDisponivel}) aqui na loja!`;
  }
  return base;
}

type FollowUpComNota = FollowUpPosCompra & { numeroNota: string | null };

// Linha da nota/cupom, pedido do Rodrigo em 2026-09-09 pra facilitar caso o cliente precise
// trocar — só entra quando a busca ao vivo no DAPIC acha um número (getNumeroNotaFiscal), nunca
// inventa nem bloqueia o resto da mensagem se não achar. Não é texto editável, sempre acrescentado
// pelo código (mesmo espírito do gancho de estoque acima).
function mensagemFollowUp(f: FollowUpComNota, templates: Record<TemplateKey, string>): string {
  const nome = primeiroNome(f.cliente);
  const produtos =
    f.produtos.length === 1
      ? f.produtos[0]
      : `${f.produtos.slice(0, -1).join(", ")} e ${f.produtos[f.produtos.length - 1]}`;
  const base = renderTemplate(templates.follow_up, { nome, produtos });
  if (f.numeroNota) {
    return `${base} E se precisar trocar alguma coisa, já separa o número da nota aqui: ${f.numeroNota}.`;
  }
  return base;
}

// Achado em 2026-09-09: com ~100 clientes de follow-up, disparar tudo de uma vez via Promise.all
// estourava o rate limit do DAPIC (429 em cascata, cada um com retry/backoff) e deixava a página
// perto de 1min30 pra carregar. Rodando com um teto de chamadas simultâneas em vez de tudo junto,
// o mesmo lote caiu pra ~15-20s (testado local, 105 clientes, zero 429).
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

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

function TabelaSugestoes({
  loja,
  sugestoes,
  clienteHref,
  contatosMap,
  podeVerCheck,
  templates,
}: {
  loja: string;
  sugestoes: SugestaoContato[];
  clienteHref: (nome: string) => string;
  contatosMap: Map<string, ContatoInfo>;
  podeVerCheck: boolean;
  templates: Record<TemplateKey, string>;
}) {
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
              <td className="px-4 py-2 font-medium">
                <a href={clienteHref(s.cliente)} className="hover:underline">{s.cliente}</a>
              </td>
              <td className="px-4 py-2">
                {s.telefone ? (
                  <ContatoWhatsappLink
                    telefone={s.telefone}
                    href={waHref(s.telefone, mensagemSugestao(s, templates))}
                    tipo="sugestao"
                    cliente={s.cliente}
                    chave={s.motivo}
                    contatadoInicial={contatosMap.get(`sugestao|${s.cliente}|${s.motivo}`) ?? null}
                    podeVerCheck={podeVerCheck}
                  />
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

function TabelaFollowUp({
  loja,
  itens,
  clienteHref,
  contatosMap,
  podeVerCheck,
  templates,
}: {
  loja: string;
  itens: FollowUpComNota[];
  clienteHref: (nome: string) => string;
  contatosMap: Map<string, ContatoInfo>;
  podeVerCheck: boolean;
  templates: Record<TemplateKey, string>;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <h3 className="border-b border-[var(--gridline)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)]">{loja} <span className="font-normal text-[var(--text-muted)]">({itens.length})</span></h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
            <th className="px-4 py-2 font-medium">Cliente</th>
            <th className="px-4 py-2 font-medium">Contato</th>
            <th className="px-4 py-2 font-medium">Produto(s) comprado(s)</th>
            <th className="px-4 py-2 font-medium">Nota/cupom</th>
            <th className="px-4 py-2 font-medium">Há quantos dias</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((f) => (
            <tr key={f.cliente} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
              <td className="px-4 py-2 font-medium">
                <a href={clienteHref(f.cliente)} className="hover:underline">{f.cliente}</a>
              </td>
              <td className="px-4 py-2">
                {f.telefone ? (
                  <ContatoWhatsappLink
                    telefone={f.telefone}
                    href={waHref(f.telefone, mensagemFollowUp(f, templates))}
                    tipo="followup"
                    cliente={f.cliente}
                    chave={String(f.dapicVendaId)}
                    contatadoInicial={contatosMap.get(`followup|${f.cliente}|${f.dapicVendaId}`) ?? null}
                    podeVerCheck={podeVerCheck}
                  />
                ) : (
                  <span className="text-[var(--text-muted)]">—</span>
                )}
              </td>
              <td className="px-4 py-2 text-[var(--text-secondary)]">{f.produtos.join(", ")}</td>
              <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">{f.numeroNota ?? <span className="text-[var(--text-muted)]">—</span>}</td>
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

  // Pedido do Rodrigo em 2026-09-09: vendedor continua marcando contato normalmente ao clicar
  // (o registro grava do mesmo jeito), só não VÊ o ✓ — só Admin/Gestão enxergam quem já contatou.
  const podeVerCheck = user.role !== "VENDEDOR";

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

  const [stores, marcas, tabelasPreco, sugestoes, followUp, templates] = await Promise.all([
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getSugestoesDeContato(filters),
    getFollowUpPosCompra(filters),
    getMensagemTemplates(),
  ]);

  function clienteHref(nome: string) {
    const p = new URLSearchParams();
    for (const id of filters.storeIds ?? []) p.append("store", id);
    for (const m of filters.marcas ?? []) p.append("marca", m);
    for (const t of filters.tabelasPreco ?? []) p.append("tabelaPreco", t);
    p.set("cliente", nome);
    return `/dashboard/clientes-ficha?${p.toString()}`;
  }

  const sugestoesPorLoja = agruparPorLoja(sugestoes);

  // Número da nota/cupom buscado ao vivo no DAPIC, um por cliente do follow-up (não faz parte
  // do sync em lote) — ver getNumeroNotaFiscal. Concorrência limitada (ver mapWithConcurrency).
  const followUpComNota: FollowUpComNota[] = await mapWithConcurrency(followUp, 8, async (f) => ({
    ...f,
    numeroNota: await getNumeroNotaFiscal(f.storeId, f.dapicVendaId),
  }));
  const followUpPorLoja = agruparPorLoja(followUpComNota);

  // Marcações de "já contatei" (ver ContatoMarcado) pros clientes visíveis nessa página agora —
  // busca só pelo nome (não tem dado grande o suficiente pra precisar de filtro extra).
  const clientesVisiveis = [...new Set([...sugestoes.map((s) => s.cliente), ...followUpComNota.map((f) => f.cliente)])];
  const contatosMarcados = clientesVisiveis.length
    ? await prisma.contatoMarcado.findMany({ where: { cliente: { in: clientesVisiveis } } })
    : [];
  const contatosMap = new Map<string, ContatoInfo>(
    contatosMarcados.map((c) => [`${c.tipo}|${c.cliente}|${c.chave}`, { contatadoPor: c.contatadoPor, contatadoEm: c.contatadoEm.toISOString() }])
  );

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
          <TabelaSugestoes key={loja} loja={loja} sugestoes={itens} clienteHref={clienteHref} contatosMap={contatosMap} podeVerCheck={podeVerCheck} templates={templates} />
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
            <TabelaFollowUp key={loja} loja={loja} itens={itens} clienteHref={clienteHref} contatosMap={contatosMap} podeVerCheck={podeVerCheck} templates={templates} />
          ))}
          {followUpPorLoja.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">Nenhuma compra B2C nessa janela de 7-10 dias atrás.</p>
          )}
        </div>
      </section>
    </div>
  );
}
