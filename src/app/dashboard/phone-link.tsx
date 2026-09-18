"use client";

import { useState } from "react";
import { formatTelefoneDisplay, telefoneParaTel } from "@/lib/phone";
import { waHref } from "@/lib/whatsapp";
import { usePhoneMode } from "./phone-mode";

// Substituto padrão de "<a href={waHref(tel)}>{tel}</a>" usado em várias abas (Clientes, Ficha
// do Cliente, Segmentação, Produto → Cliente, Pesquisa, Atacado → Clientes) — telefone formatado
// + ação extra conforme o modo Celular/Computador (ver phone-mode.tsx, escolha global do
// usuário). O link do WhatsApp em si (waHref) é sempre o mesmo, independente do modo — só a
// apresentação e o botão extra mudam. Pedido do Rodrigo em 2026-09-18: estender a mesma
// experiência de telefone da aba Sugestão de Contato pro TVB Radar inteiro.
export function PhoneLink({ telefone, mensagem, className }: { telefone: string; mensagem?: string; className?: string }) {
  const { mode } = usePhoneMode();
  const [copiado, setCopiado] = useState(false);

  return (
    <span className="inline-flex items-center gap-1.5">
      <a
        href={waHref(telefone, mensagem)}
        target="_blank"
        rel="noopener noreferrer"
        className={className ?? "text-[var(--series-1)] hover:underline tabular-nums"}
      >
        {formatTelefoneDisplay(telefone)}
      </a>
      {mode === "mobile" ? (
        <a
          href={`tel:+${telefoneParaTel(telefone)}`}
          title="Ligar"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm hover:bg-[var(--page-plane)]"
        >
          📞
        </a>
      ) : (
        <button
          type="button"
          title="Copiar número"
          onClick={() => {
            navigator.clipboard.writeText(formatTelefoneDisplay(telefone)).then(() => {
              setCopiado(true);
              setTimeout(() => setCopiado(false), 1500);
            });
          }}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm hover:bg-[var(--page-plane)]"
        >
          {copiado ? "✅" : "📋"}
        </button>
      )}
    </span>
  );
}
