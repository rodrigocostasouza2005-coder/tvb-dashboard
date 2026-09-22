// Skeleton genérico mostrado por baixo do header/menu (layout.tsx) enquanto o page.tsx de
// qualquer aba resolve seus Promise.all — sem isso a tela ficava em branco até tudo carregar.
// Formato aproxima o que a maioria das abas tem (filtro, cards, tabela/gráfico), não precisa
// bater exato com cada página.
export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden="true">
      <div className="h-10 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]" />
        ))}
      </div>
      <div className="h-64 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]" />
      <div className="h-48 rounded-lg border border-[var(--border)] bg-[var(--surface-1)]" />
    </div>
  );
}
