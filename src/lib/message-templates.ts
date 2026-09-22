import { prisma } from "@/lib/prisma";

export type TemplateKey =
  | "vip_esfriando"
  | "recorrente_esfriando"
  | "em_risco"
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

// Texto único pros 4 motivos "esfriando"/"em risco"/"1 compra" — pedido do Rodrigo em
// 2026-09-21: consolidar num só, em vez de 1 texto diferente por motivo como era antes.
const TEXTO_ESFRIANDO_UNIFICADO = `Falaa, {nome}! Tudo beleza?

Lembramos da sua primeira compra na TVB e bateu aquela saudade de te ver por aqui de novo!

De lá pra cá, muita coisa aconteceu e temos novidades te esperando.

A Coleção Verão Épico 27 já está no ar na TVBSHORTS com peças absurdas, novidades e aquele estilo que você já conhece.

Se curtiu a primeira, espera só pra ver o que chegou agora!

Vem conferir a nova coleção e escolher seu próximo TVB no {shopping}`;

// Textos originais (ver histórico de clientes-sugestoes-contato/page.tsx) — usados como valor
// inicial na 1ª vez que a tela de edição carrega (ainda sem linha no banco pra aquela chave) e
// como "restaurar padrão". Placeholders viram o dado real na hora de montar a mensagem — ver
// renderTemplate().
export const TEMPLATE_KEYS: TemplateInfo[] = [
  {
    key: "vip_esfriando",
    label: "VIP esfriando",
    placeholders: ["nome", "shopping"],
    defaultTexto: TEXTO_ESFRIANDO_UNIFICADO,
    extra: "{shopping} = shopping da loja principal do cliente, preenchido automaticamente (Shopping Leblon / Barra Shopping / Shopping Rio Sul). Pedido do Rodrigo em 2026-09-21: mesmo texto usado nos 4 motivos \"esfriando\"/\"em risco\"/\"1 compra\".",
  },
  {
    key: "recorrente_esfriando",
    label: "Recorrente esfriando",
    placeholders: ["nome", "shopping"],
    defaultTexto: TEXTO_ESFRIANDO_UNIFICADO,
    extra: "{shopping} = shopping da loja principal do cliente, preenchido automaticamente. Se o tamanho do produto favorito dele ainda estiver em estoque, uma linha extra é adicionada automaticamente no final.",
  },
  {
    key: "em_risco",
    label: "Em risco",
    placeholders: ["nome", "shopping"],
    defaultTexto: TEXTO_ESFRIANDO_UNIFICADO,
    extra: "{shopping} = shopping da loja principal do cliente, preenchido automaticamente.",
  },
  {
    key: "comprou_1_vez",
    label: "Comprou só 1 vez",
    placeholders: ["nome", "shopping"],
    defaultTexto: TEXTO_ESFRIANDO_UNIFICADO,
    extra: "{shopping} = shopping da loja principal do cliente, preenchido automaticamente.",
  },
  {
    key: "aniversario",
    label: "Aniversário",
    placeholders: ["nome"],
    defaultTexto: `Feliz aniversário, {nome}! 🎉❤️

Hoje é um dia especial e não poderíamos deixar de passar por aqui para te desejar um novo ciclo cheio de coisas boas, momentos felizes e muitas conquistas! Izaaa

É um prazer ter você na nossa família TVB. 🌊

Com carinho, TVB SHORTS.`,
  },
  {
    key: "follow_up",
    label: "Follow-up pós-compra",
    placeholders: ["nome", "produtos", "codigo"],
    defaultTexto: `Oi, {nome}! Tudo beleza?

Aqui é da TVB SHORTS! Passando pra saber se você curtiu o {produtos}.
E se tem algum feedback pra gente!

Se precisar de qualquer coisa, é só chamar a gente por aqui!

Obrigado pela compra e por escolher a TVB.

Código da venda: {codigo}`,
    extra: "{codigo} = código real da venda que gerou esse follow-up (não é o mesmo id interno do sistema). Se a nota/cupom fiscal da compra também for encontrada, uma linha extra com o número é adicionada automaticamente no final.",
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
