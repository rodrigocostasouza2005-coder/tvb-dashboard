import { prisma } from "@/lib/prisma";

export type TemplateKey =
  | "vip_esfriando"
  | "recorrente_esfriando"
  | "em_risco"
  | "inativo"
  | "comprou_1_vez"
  | "aniversario"
  | "follow_up";

export type TemplateInfo = {
  key: TemplateKey;
  label: string;
  placeholders: string[];
  defaultTexto: string;
  extra?: string;
};

// Textos originais (ver histórico de clientes-sugestoes-contato/page.tsx) — usados como valor
// inicial na 1ª vez que a tela de edição carrega (ainda sem linha no banco pra aquela chave) e
// como "restaurar padrão". Placeholders viram o dado real na hora de montar a mensagem — ver
// renderTemplate().
export const TEMPLATE_KEYS: TemplateInfo[] = [
  {
    key: "vip_esfriando",
    label: "VIP esfriando",
    placeholders: ["nome", "detalhe"],
    defaultTexto: "E aí {nome}, sumiu! 😄 Faz um tempinho que você não passa aqui na TVB ({detalhe}) — bora dar uma olhada no que chegou de novo?",
    extra: "Se o tamanho do produto favorito do cliente ainda estiver em estoque, uma linha extra é adicionada automaticamente no final.",
  },
  {
    key: "recorrente_esfriando",
    label: "Recorrente esfriando",
    placeholders: ["nome", "detalhe"],
    defaultTexto: "Oi {nome}, tudo bem? Notei que você não aparece por aqui há um tempo ({detalhe}). Só passando pra saber se tá tudo certo e se posso te ajudar a achar alguma coisa!",
    extra: "Se o tamanho do produto favorito do cliente ainda estiver em estoque, uma linha extra é adicionada automaticamente no final.",
  },
  {
    key: "em_risco",
    label: "Em risco",
    placeholders: ["nome"],
    defaultTexto: `Falaaa, {nome}! 🌊

Quanto tempo, hein? 😎 A gente percebeu que faz um tempinho que você não aparece por aqui e, vou te falar… *sentimos sua falta na família TVB!* 👊

Nesse tempo, rolou novidade, chegaram coisas novas e a TVB continua naquela vibe que você já conhece. 🏄‍♂️🔥

E como a gente quer te ver de volta por aqui, resolvemos liberar um *benefício exclusivo só pra você.* 👀

*Use o cupom VOLTA10 e ganhe 10% OFF na sua próxima compra.* 🔥

Então aproveita pra dar aquela passada, conferir as novidades e ver o que chegou por aqui. 😎

*Porque a TVB tá sempre na mesma vibe… só tava faltando você por aqui. 🌊🤙*`,
  },
  {
    key: "inativo",
    label: "Inativo",
    placeholders: ["nome"],
    defaultTexto: `Falaaa, {nome}! 🌊

Quanto tempo, hein? 😎 A gente percebeu que faz um tempinho que você não aparece por aqui e, vou te falar… *sentimos sua falta na família TVB!* 👊

Nesse tempo, rolou novidade, chegaram coisas novas e a TVB continua naquela vibe que você já conhece. 🏄‍♂️🔥

E como a gente quer te ver de volta por aqui, resolvemos liberar um *benefício exclusivo só pra você.* 👀

*Use o cupom VOLTA10 e ganhe 10% OFF na sua próxima compra.* 🔥

Então aproveita pra dar aquela passada, conferir as novidades e ver o que chegou por aqui. 😎

*Porque a TVB tá sempre na mesma vibe… só tava faltando você por aqui. 🌊🤙*`,
  },
  {
    key: "comprou_1_vez",
    label: "Comprou só 1 vez",
    placeholders: ["nome"],
    defaultTexto: `Falaaa, {nome}! 🌊

Você já passou pela TVB uma vez e a gente queria te ver por aqui de novo! 😎👊

Tem novidade chegando, coisas novas rolando e aquela vibe que você já conhece. 🏄‍♂️🔥

E pra te dar um motivo a mais pra voltar, *separamos um benefício exclusivo pra você.* 👀

*Use o cupom VOLTA10 e ganhe 10% OFF na sua próxima compra.* 🔥

Então já sabe: aproveita o desconto, dá uma olhada no site e vem conferir o que tá rolando por aqui! 🤙

*Porque a TVB tá sempre na mesma vibe… só tava faltando você por aqui. 🌊🤙*`,
  },
  {
    key: "aniversario",
    label: "Aniversário",
    placeholders: ["nome"],
    defaultTexto: `Falaaa, {nome}! 🎉🌊

Hoje é seu dia e a gente não podia deixar passar em branco! 😎🎂

Você já faz parte da família TVB e está sempre colando com a gente. Então, nada mais justo do que comemorar seu aniversário com um *presente especial nosso pra você!* 👊🔥

Preparamos um *cupom exclusivo de aniversário*:

🎁 *Use o cupom ANIVER15 e ganhe 15% OFF na sua próxima compra!*

É o nosso jeito de agradecer por estar sempre com a gente e fazer parte da família TVB. 💙

Então aproveita seu dia, comemora muito e já sabe: quando quiser dar aquela renovada na vibe, a TVB tá te esperando! 🏄‍♂️🔥

*Que esse novo ciclo venha cheio de coisa boa, boas energias e, claro, muita vibe boa! 🌊🏄‍♂️*`,
  },
  {
    key: "follow_up",
    label: "Follow-up pós-compra",
    placeholders: ["nome", "produtos"],
    defaultTexto: "Oi {nome}! Aqui é da TVB Shorts. Passando pra saber se você curtiu o(a) {produtos} — chegou tudo certinho, serviu bem? Qualquer coisa é só chamar!",
    extra: "Se a nota/cupom fiscal da compra for encontrada, uma linha extra com o número é adicionada automaticamente no final.",
  },
];

const TEMPLATE_BY_KEY = new Map(TEMPLATE_KEYS.map((t) => [t.key, t]));

export function defaultTextoFor(key: TemplateKey): string {
  return TEMPLATE_BY_KEY.get(key)?.defaultTexto ?? "";
}

// Busca todos os templates salvos no banco — chave sem linha ainda (nunca editada) cai no
// defaultTexto. Tabela pequena (7 linhas no máximo), sem necessidade de cache.
export async function getMensagemTemplates(): Promise<Record<TemplateKey, string>> {
  const rows = await prisma.mensagemTemplate.findMany();
  const byId = new Map(rows.map((r) => [r.id, r.texto]));
  const result = {} as Record<TemplateKey, string>;
  for (const t of TEMPLATE_KEYS) {
    result[t.key] = byId.get(t.key) ?? t.defaultTexto;
  }
  return result;
}

// Substitui {placeholder} pelo valor real — placeholder sem valor correspondente vira string
// vazia (nunca quebra a mensagem, mesmo se o Rodrigo digitar um placeholder que não existe).
export function renderTemplate(texto: string, vars: Record<string, string>): string {
  return texto.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}
