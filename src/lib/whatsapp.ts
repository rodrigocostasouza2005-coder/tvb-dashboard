// Telefone no cadastro vem em formatos variados do DAPIC — só dígitos ("21998687139"), com DDI
// ("5521968267784") ou formatado ("(21) 995594449"). wa.me exige só dígitos com DDI (55) na
// frente. Pedido do Rodrigo em 2026-08-31: clicar no telefone em qualquer tela do CRM abre direto
// o WhatsApp, pra facilitar o atendimento.
//
// mensagem (opcional): pré-preenche o campo de texto do WhatsApp (?text=), pedido do Rodrigo em
// 2026-08-31 — a pessoa ainda revisa/edita antes de mandar, o wa.me nunca envia sozinho.
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
  const texto = mensagem ? `?text=${encodeURIComponent(mensagem)}` : "";
  return `https://wa.me/${numero}${texto}`;
}
