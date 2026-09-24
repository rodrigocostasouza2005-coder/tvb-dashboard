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
  } else if (digits.length === 12 && digits.startsWith("0") && !digits.startsWith("00")) {
    // Achado em 2026-09-24 revisando dado real: 23 telefones no banco vêm como "0" + DDD +
    // celular (12 dígitos, ex: "021993657765") — prefixo de discagem digitado por engano, não
    // DDI nenhum (DDI de verdade é 2-3 dígitos, nunca "0"). Sem tratar isso, caía direto no
    // fallback (mostrava o número cru, sem formatar) — destoava no meio de uma lista onde a
    // maioria já aparecia formatada. `!startsWith("00")` evita capturar por engano um DDI real
    // de 2 dígitos que por coincidência começe com 0 (nenhum DDI começa com 0, mas a dupla
    // checagem deixa a regra explícita em vez de depender só do length).
    semDdi = digits.slice(1);
  } else {
    // Formato inesperado (curto/longo demais, ou DDI estrangeiro) — não inventa dígito nenhum,
    // deixa pro fallback (mostra o texto original) em vez de arriscar um número formatado errado.
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

// Mesma lógica de extração de DDD+número que formatTelefoneDisplay usa acima (inclusive o caso
// "0" + DDD + celular, achado em 2026-09-24) — waHref/waAppHref (lib/whatsapp.ts) e o link `tel:`
// do modo Celular dependem daqui. Antes da correção, esses 23 números caíam no `return digits`
// puro (sem DDI 55 nenhum) — o botão de WhatsApp/Ligar apontava pra um número errado, não só a
// exibição.
export function telefoneParaTel(telefoneRaw: string): string {
  const digits = telefoneRaw.replace(/\D/g, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length === 12 && digits.startsWith("0") && !digits.startsWith("00")) return `55${digits.slice(1)}`;
  return digits;
}
