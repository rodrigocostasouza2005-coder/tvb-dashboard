import { getSessionUser } from "@/lib/auth";
import { getStores, getMarcas, getTabelasPreco, getSugestoesDeContato, getFollowUpPosCompra, type SugestaoContato, type FollowUpPosCompra } from "@/lib/metrics";
import { getStoreRestriction, getMarcaRestriction, getTabelaPrecoRestriction } from "@/lib/permissions";
import { parseFilters, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";
import { waHref } from "@/lib/whatsapp";
import { getNumeroNotaFiscal } from "@/lib/connectors/nota-fiscal";
import { prisma } from "@/lib/prisma";
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

// Mensagens com cupom, ditadas literalmente pelo Rodrigo em 2026-09-09 (texto de marketing dele,
// não nosso) — substituem só Em risco/Inativo/Comprou só 1 vez/Aniversário. VIP esfriando e
// Recorrente esfriando continuam com o texto antigo (ver mensagemSugestaoAntiga), ele não pediu
// pra mudar essas duas. Diferente das mensagens antigas, essas NÃO ganham o gancho de estoque
// (pedido explícito dele) e não usam s.detalhe (não mencionam "há quantos dias").
function mensagemClientesFrios(nome: string): string {
  return `Falaaa, ${nome}! 🌊

Quanto tempo, hein? 😎 A gente percebeu que faz um tempinho que você não aparece por aqui e, vou te falar… *sentimos sua falta na família TVB!* 👊

Nesse tempo, rolou novidade, chegaram coisas novas e a TVB continua naquela vibe que você já conhece. 🏄‍♂️🔥

E como a gente quer te ver de volta por aqui, resolvemos liberar um *benefício exclusivo só pra você.* 👀

*Use o cupom VOLTA10 e ganhe 10% OFF na sua próxima compra.* 🔥

Então aproveita pra dar aquela passada, conferir as novidades e ver o que chegou por aqui. 😎

*Porque a TVB tá sempre na mesma vibe… só tava faltando você por aqui. 🌊🤙*`;
}

function mensagemComprouUmaVez(nome: string): string {
  return `Falaaa, ${nome}! 🌊

Você já passou pela TVB uma vez e a gente queria te ver por aqui de novo! 😎👊

Tem novidade chegando, coisas novas rolando e aquela vibe que você já conhece. 🏄‍♂️🔥

E pra te dar um motivo a mais pra voltar, *separamos um benefício exclusivo pra você.* 👀

*Use o cupom VOLTA10 e ganhe 10% OFF na sua próxima compra.* 🔥

Então já sabe: aproveita o desconto, dá uma olhada no site e vem conferir o que tá rolando por aqui! 🤙

*Porque a TVB tá sempre na mesma vibe… só tava faltando você por aqui. 🌊🤙*`;
}

function mensagemAniversario(nome: string): string {
  return `Falaaa, ${nome}! 🎉🌊

Hoje é seu dia e a gente não podia deixar passar em branco! 😎🎂

Você já faz parte da família TVB e está sempre colando com a gente. Então, nada mais justo do que comemorar seu aniversário com um *presente especial nosso pra você!* 👊🔥

Preparamos um *cupom exclusivo de aniversário*:

🎁 *Use o cupom ANIVER15 e ganhe 15% OFF na sua próxima compra!*

É o nosso jeito de agradecer por estar sempre com a gente e fazer parte da família TVB. 💙

Então aproveita seu dia, comemora muito e já sabe: quando quiser dar aquela renovada na vibe, a TVB tá te esperando! 🏄‍♂️🔥

*Que esse novo ciclo venha cheio de coisa boa, boas energias e, claro, muita vibe boa! 🌊🏄‍♂️*`;
}

// Mensagem pronta por motivo, pré-preenchida no WhatsApp (pedido do Rodrigo em 2026-09-08,
// reescrita no mesmo dia depois de pedir pra tirar "produto favorito" e alinhar com o tom real
// da marca) — ele ainda revisa/edita antes de mandar (waHref nunca envia sozinho).
//
// Duas coisas informaram a reescrita original:
// 1) Tom de voz real da TVB Shorts (tvbshorts.com): informal, bem-humorado, cultura de surf/praia,
//    sem "marketês" — usa até depoimento de cliente cru em vez de texto arrumadinho ("a gente
//    manda pouco email, até porque dá muito trabalho :)"). Nada de linguagem corporativa.
// 2) Boas práticas de reativação por WhatsApp: personalizar pelo HISTÓRICO real (aqui, dias sem
//    comprar — já vem em s.detalhe) rende mais do que "achismo de gosto" tipo produto favorito;
//    mensagem curta, tom próximo, sem urgência falsa.
//
// Gancho de estoque (pedido do Rodrigo, mesmo dia): quando o tamanho que o cliente mais compra do
// produto favorito dele ainda está disponível na loja principal, entra uma linha a mais — só
// nesse caso (nunca inventa disponibilidade, ver getTamanhoEstoqueParaClientes). Só se aplica às
// mensagens antigas (VIP/Recorrente esfriando) — as novas com cupom não ganham esse gancho.
function mensagemSugestaoAntiga(s: SugestaoContato): string {
  const nome = primeiroNome(s.cliente);
  const base = (() => {
    switch (s.motivo) {
      case "VIP esfriando":
        return `E aí ${nome}, sumiu! 😄 Faz um tempinho que você não passa aqui na TVB (${s.detalhe}) — bora dar uma olhada no que chegou de novo?`;
      case "Recorrente esfriando":
        return `Oi ${nome}, tudo bem? Notei que você não aparece por aqui há um tempo (${s.detalhe}). Só passando pra saber se tá tudo certo e se posso te ajudar a achar alguma coisa!`;
      default:
        return `Oi ${nome}, tudo bem? Aqui é da TVB Shorts!`;
    }
  })();

  if (s.tamanhoDisponivel && s.produtoFavorito) {
    return `${base} Inclusive ainda temos o ${s.produtoFavorito} no seu tamanho (${s.tamanhoDisponivel}) aqui na loja!`;
  }
  return base;
}

function mensagemSugestao(s: SugestaoContato): string {
  const nome = primeiroNome(s.cliente);
  switch (s.motivo) {
    case "Em risco":
    case "Inativo":
      return mensagemClientesFrios(nome);
    case "Comprou só 1 vez":
      return mensagemComprouUmaVez(nome);
    case "Aniversário":
      return mensagemAniversario(nome);
    default:
      return mensagemSugestaoAntiga(s);
  }
}

type FollowUpComNota = FollowUpPosCompra & { numeroNota: string | null };

// Linha da nota/cupom, pedido do Rodrigo em 2026-09-09 pra facilitar caso o cliente precise
// trocar — só entra quando a busca ao vivo no DAPIC acha um número (getNumeroNotaFiscal),
// nunca inventa nem bloqueia o resto da mensagem se não achar.
function mensagemFollowUp(f: FollowUpComNota): string {
  const nome = primeiroNome(f.cliente);
  const produtos =
    f.produtos.length === 1
      ? f.produtos[0]
      : `${f.produtos.slice(0, -1).join(", ")} e ${f.produtos[f.produtos.length - 1]}`;
  const base = `Oi ${nome}! Aqui é da TVB Shorts. Passando pra saber se você curtiu o(a) ${produtos} — chegou tudo certinho, serviu bem? Qualquer coisa é só chamar!`;
  if (f.numeroNota) {
    return `${base} E se precisar trocar alguma coisa, já separa o número da nota aqui: ${f.numeroNota}.`;
  }
  return base;
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
}: {
  loja: string;
  sugestoes: SugestaoContato[];
  clienteHref: (nome: string) => string;
  contatosMap: Map<string, ContatoInfo>;
  podeVerCheck: boolean;
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
                    href={waHref(s.telefone, mensagemSugestao(s))}
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
}: {
  loja: string;
  itens: FollowUpComNota[];
  clienteHref: (nome: string) => string;
  contatosMap: Map<string, ContatoInfo>;
  podeVerCheck: boolean;
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
                    href={waHref(f.telefone, mensagemFollowUp(f))}
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

  const [stores, marcas, tabelasPreco, sugestoes, followUp] = await Promise.all([
    getStores(allowedStores),
    getMarcas(allowedMarcas),
    getTabelasPreco(allowedTabelasPreco),
    getSugestoesDeContato(filters),
    getFollowUpPosCompra(filters),
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

  // Número da nota/cupom buscado ao vivo no DAPIC, só pra esse punhado de clientes do
  // follow-up (não faz parte do sync em lote) — ver getNumeroNotaFiscal.
  const followUpComNota: FollowUpComNota[] = await Promise.all(
    followUp.map(async (f) => ({ ...f, numeroNota: await getNumeroNotaFiscal(f.storeId, f.dapicVendaId) }))
  );
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
          <TabelaSugestoes key={loja} loja={loja} sugestoes={itens} clienteHref={clienteHref} contatosMap={contatosMap} podeVerCheck={podeVerCheck} />
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
            <TabelaFollowUp key={loja} loja={loja} itens={itens} clienteHref={clienteHref} contatosMap={contatosMap} podeVerCheck={podeVerCheck} />
          ))}
          {followUpPorLoja.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">Nenhuma compra B2C nessa janela de 7-10 dias atrás.</p>
          )}
        </div>
      </section>
    </div>
  );
}
