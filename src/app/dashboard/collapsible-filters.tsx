import type { ReactNode } from "react";

// <details> nativo, sem JS/client state — abrir/fechar é 100% do navegador, então clicar em
// qualquer coisa DENTRO do painel (checkbox, Aplicar, um link de loja) nunca fecha o painel
// sozinho. defaultOpen vem do parâmetro "filtros" na URL: o form da FilterBar (e os links da
// Lâmina Mensal) mandam "filtros=1" de volta sempre que a ação partiu de dentro do painel
// aberto, então depois de aplicar um filtro a página recarrega já com o painel aberto — pedido
// do Rodrigo em 2026-08-24: "eu só quero que ele feche se eu clicar pra fechar".
export function CollapsibleFilters({ children, defaultOpen = false }: { children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group mb-6" open={defaultOpen}>
      <summary className="mb-2 flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)] [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">▸</span>
        Filtros
      </summary>
      <div>{children}</div>
    </details>
  );
}
