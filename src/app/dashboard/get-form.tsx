"use client";

import { useRouter } from "next/navigation";
import type { FormEvent, ReactNode } from "react";

// Substituto client-side de "<form method='GET' action=...>" — o form nativo faz um GET de
// verdade (recarregamento completo de página no navegador), que sempre reseta o scroll e refaz a
// página inteira do zero. Interceptando o submit e navegando via router.push com scroll:false, o
// Next.js troca só o conteúdo (RSC continua rodando no server com os novos searchParams — os
// dados continuam atualizando certinho), mas SEM voltar a página pro topo. Pedido do Rodrigo em
// 2026-09-25: "clique → volta pro topo" acontecia em praticamente todo filtro do Radar (FilterBar,
// Comparar, etc) porque todos eram <form method="GET"> nativos — esse componente é o substituto
// padrão a partir de agora.
export function GetForm({
  action,
  className,
  children,
}: {
  action: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form).entries()) {
      if (typeof value === "string") params.append(key, value);
    }
    router.push(`${action}?${params.toString()}`, { scroll: false });
  }

  return (
    <form action={action} method="GET" onSubmit={handleSubmit} className={className}>
      {children}
    </form>
  );
}
