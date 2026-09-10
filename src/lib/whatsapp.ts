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
// pré-processamento do servidor que causa a corrupção.
export function waHref(telefoneRaw: string, mensagem?: string): string {
  const digits = telefoneRaw.replace(/\D/g, "");
  let numero: string;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    numero = digits;
  } else if (digits.length === 10 || digits.length === 11) {
    numero = `55${digits}`;
  } else {
    // Formato inesperado — melhor esforço, sem quebrar o link.
    numero = digits;
  }
  const texto = mensagem ? `&text=${encodeURIComponent(mensagem)}` : "";
  return `https://web.whatsapp.com/send?phone=${numero}${texto}`;
}
