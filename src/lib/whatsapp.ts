import { telefoneParaTel } from "./phone";

// Telefone no cadastro vem em formatos variados do DAPIC — só dígitos ("21998687139"), com DDI
// ("5521968267784") ou formatado ("(21) 995594449"). wa.me exige só dígitos com DDI (55) na
// frente. Pedido do Rodrigo em 2026-08-31: clicar no telefone em qualquer tela do CRM abre direto
// o WhatsApp, pra facilitar o atendimento.
//
// mensagem (opcional): pré-preenche o campo de texto do WhatsApp (?text=), pedido do Rodrigo em
// 2026-08-31 — a pessoa ainda revisa/edita antes de mandar, nunca envia sozinho.
//
// Achado em 2026-09-10: link `wa.me` (e `api.whatsapp.com`, mesmo backend) corrompe emoji fora do
// plano básico (a maioria dos emoji modernos, ex: 😄🌊🎉 — qualquer um que precisa de par substituto
// UTF-16) na própria tela de preview deles, e essa versão já corrompida é o que segue pro chat de
// verdade ao clicar "Continuar pro WhatsApp Web" — confirmado batendo direto no servidor deles via
// curl com o mesmo texto codificado certo, sem navegador/fonte/SO no meio (bug do lado do WhatsApp,
// não dá pra corrigir por aqui). `web.whatsapp.com/send` pula essa tela de preview problemática —
// é a própria SPA do WhatsApp Web que lê a URL direto via JS do navegador, sem passar pelo
// pré-processamento do servidor que causa a corrupção. Continua sendo o link certo pro modo
// Computador (ver waAppHref abaixo pro modo Celular, que usa outro mecanismo de propósito).
export function waHref(telefoneRaw: string, mensagem?: string): string {
  const numero = telefoneParaTel(telefoneRaw);
  const texto = mensagem ? `&text=${encodeURIComponent(mensagem)}` : "";
  return `https://web.whatsapp.com/send?phone=${numero}${texto}`;
}

// Abre o APP nativo do WhatsApp (não o navegador) — pedido do Rodrigo em 2026-09-18: no modo
// Celular, tocar no telefone deve ir direto pro app, não pro WhatsApp Web. `wa.me`/
// `api.whatsapp.com` foi descartado de propósito aqui: é a mesma origem que corrompe emoji (ver
// comentário em waHref acima) — mesmo em celular, o link `https://wa.me/...` normalmente passa
// pelo servidor deles antes de abrir o app, arriscando o mesmo bug. O esquema `whatsapp://` é
// resolvido 100% pelo app instalado no aparelho, sem nenhum request pro servidor do WhatsApp no
// meio — evita a corrupção por construção, não só na prática. Só funciona com o app já instalado
// (sem fallback pra versão web) — aceitável aqui porque é ferramenta de trabalho da equipe de
// loja, que já usa WhatsApp o dia inteiro.
export function waAppHref(telefoneRaw: string, mensagem?: string): string {
  const numero = telefoneParaTel(telefoneRaw);
  const texto = mensagem ? `&text=${encodeURIComponent(mensagem)}` : "";
  return `whatsapp://send?phone=${numero}${texto}`;
}
