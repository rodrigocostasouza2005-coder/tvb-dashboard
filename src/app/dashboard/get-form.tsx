"use client";

import { useRouter } from "next/navigation";
import { useTransition, type FormEvent, type ReactNode } from "react";

// Substituto client-side de "<form method='GET' action=...>" — o form nativo faz um GET de
// verdade (recarregamento completo de página no navegador), que sempre reseta o scroll e refaz a
// página inteira do zero. Interceptando o submit e navegando via router.push com scroll:false, o
// Next.js troca só o conteúdo (RSC continua rodando no server com os novos searchParams — os
// dados continuam atualizando certinho), mas SEM voltar a página pro topo. Pedido do Rodrigo em
// 2026-09-25: "clique → volta pro topo" acontecia em praticamente todo filtro do Radar (FilterBar,
// Comparar, etc) porque todos eram <form method="GET"> nativos — esse componente é o substituto
// padrão a partir de agora.
//
// router.push disparado FORA de uma transition faz o React tratar a troca de searchParams como
// update "urgente": como toda página do Radar é um único Server Component async que só devolve
// JSX depois do Promise.all de métricas resolver, o Suspense mais próximo que cobre esse update é
// o loading.tsx de app/dashboard/ (ele embrulha page.tsx inteiro, filtro incluso) — resultado:
// ao trocar QUALQUER filtro, a página some e volta o skeleton genérico até os dados novos
// chegarem (achado de 2026-10-05, Rodrigo reportando "tela fica branca"). Envolvendo o mesmo
// router.push em startTransition, o React NÃO troca pelo fallback do Suspense já revelado —
// mantém o conteúdo atual na tela e só expõe isPending, trocando pro conteúdo novo de uma vez
// quando estiver pronto (comportamento documentado do React pra Suspense+transition, não depende
// de nenhuma mudança nas páginas em si). Sem isso o único jeito de evitar o loading.tsx genérico
// seria quebrar cada page.tsx em shell+Suspense interno — refatoração grande demais pra esse bug.
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
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form).entries()) {
      if (typeof value === "string") params.append(key, value);
    }
    startTransition(() => {
      router.push(`${action}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <form
      action={action}
      method="GET"
      onSubmit={handleSubmit}
      className={className}
      aria-busy={isPending}
      style={{
        opacity: isPending ? 0.6 : 1,
        pointerEvents: isPending ? "none" : undefined,
        transition: "opacity 0.15s ease",
      }}
    >
      {children}
    </form>
  );
}
