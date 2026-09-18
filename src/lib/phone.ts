// Formatação VISUAL de telefone (BR) — nunca altera o valor salvo no banco, e é independente do
// normalizador usado pro WhatsApp (ver waHref em lib/whatsapp.ts, que continua a única fonte de
// verdade pro link). Pedido do Rodrigo em 2026-09-18: número amigável tipo "(21) 99999-9999"
// (celular) ou "(21) 9999-9999" (fixo) na aba Sugestões de Contato.
//
// Mesma lógica de detecção de DDI que waHref já usa (55 + 12/13 dígitos = já tem DDI; 10/11
// dígitos = DDD+número sem DDI) — reaproveitada aqui só pra não duplicar a regra em dois lugares
// com resultado diferente.
function extrairDddNumero(telefoneRaw: string): { ddd: string; numero: string } | null {
  const digits = telefoneRaw.replace(/\D/g, "");
  let semDdi: string;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    semDdi = digits.slice(2);
  } else if (digits.length === 10 || digits.length === 11) {
    semDdi = digits;
  } else {
    // Formato inesperado (curto/longo demais) — não inventa dígito nenhum, deixa pro
    // fallback (mostra o texto original) em vez de arriscar um número formatado errado.
    return null;
  }
  return { ddd: semDdi.slice(0, 2), numero: semDdi.slice(2) };
}

// Só formatação — se o número não bater num formato BR reconhecível (DDD + 8 ou 9 dígitos),
// devolve o texto original sem mexer, nunca tenta "consertar" ou completar dígito.
export function formatTelefoneDisplay(telefoneRaw: string): string {
  const partes = extrairDddNumero(telefoneRaw);
  if (!partes) return telefoneRaw;
  const { ddd, numero } = partes;
  if (numero.length === 9) return `(${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
  if (numero.length === 8) return `(${ddd}) ${numero.slice(0, 4)}-${numero.slice(4)}`;
  return telefoneRaw;
}

// Mesma extração de dígitos que waHref (lib/whatsapp.ts) usa — reaproveitada aqui só pro link
// `tel:` do modo Celular (ligação direta), nunca pro link do WhatsApp em si (esse continua
// vindo só de waHref).
export function telefoneParaTel(telefoneRaw: string): string {
  const digits = telefoneRaw.replace(/\D/g, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}
