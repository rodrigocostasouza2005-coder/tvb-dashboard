"use client";

import type { ReactNode } from "react";

// Mesmo padrão já usado em mapa-compras-grid.tsx (form dentro de "use client") — um <form
// action={serverAction}> renderizado direto por um Server Component (sem nenhum boundary
// "use client" no caminho) não liga o handler de submit nesta versão do Next; isolando o
// <form> aqui garante que o root client exista para o progressive enhancement funcionar.
export function ActionForm({
  action,
  className,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  className?: string;
  children: ReactNode;
}) {
  return (
    <form action={action} className={className}>
      {children}
    </form>
  );
}
