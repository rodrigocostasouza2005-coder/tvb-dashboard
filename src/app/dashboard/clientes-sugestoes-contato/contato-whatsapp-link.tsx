"use client";

import { useState, useTransition } from "react";
import { marcarContatadoAction, desmarcarContatadoAction, type ContatoTipo } from "./actions";

type Contato = { contatadoPor: string; contatadoEm: string };

export function ContatoWhatsappLink({
  telefone,
  href,
  tipo,
  cliente,
  chave,
  contatadoInicial,
  podeVerCheck,
}: {
  telefone: string;
  href: string;
  tipo: ContatoTipo;
  cliente: string;
  chave: string;
  contatadoInicial: Contato | null;
  // Pedido do Rodrigo em 2026-09-09: vendedor continua marcando ao clicar (o registro é
  // gravado normalmente), só não VÊ o ✓ — só Admin/Gestão enxergam quem já foi contatado.
  podeVerCheck: boolean;
}) {
  const [contato, setContato] = useState<Contato | null>(contatadoInicial);
  const [, startTransition] = useTransition();

  // Marca sozinho no clique do link — não é confirmação de envio de verdade (fora do alcance sem
  // WhatsApp Business API), é só "clicou = considerou contatado". Ver comentário no schema.
  function handleClick() {
    if (contato) return;
    startTransition(async () => {
      const rec = await marcarContatadoAction(tipo, cliente, chave);
      setContato(rec);
    });
  }

  function handleUnmark(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setContato(null);
    startTransition(() => {
      desmarcarContatadoAction(tipo, cliente, chave);
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        className="text-[var(--series-1)] hover:underline tabular-nums"
      >
        {telefone}
      </a>
      {podeVerCheck && contato && (
        <button
          type="button"
          onClick={handleUnmark}
          title={`Contatado por ${contato.contatadoPor} em ${new Date(contato.contatadoEm).toLocaleDateString("pt-BR")} — clique pra desmarcar`}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--status-good)] text-[10px] leading-none text-white"
        >
          ✓
        </button>
      )}
    </span>
  );
}
