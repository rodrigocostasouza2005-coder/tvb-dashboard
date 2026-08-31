// Telefone no cadastro vem em formatos variados do DAPIC — só dígitos ("21998687139"), com DDI
// ("5521968267784") ou formatado ("(21) 995594449"). wa.me exige só dígitos com DDI (55) na
// frente. Pedido do Rodrigo em 2026-08-31: clicar no telefone em qualquer tela do CRM abre direto
// o WhatsApp, pra facilitar o atendimento.
export function waHref(telefoneRaw: string): string {
  const digits = telefoneRaw.replace(/\D/g, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return `https://wa.me/${digits}`;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `https://wa.me/55${digits}`;
  }
  // Formato inesperado — melhor esforço, sem quebrar o link.
  return `https://wa.me/${digits}`;
}
