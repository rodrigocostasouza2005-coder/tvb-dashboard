import { getSessionUser } from "@/lib/auth";
import { getContatosPorVendedor } from "@/lib/metrics";
import { brasiliaDayStart, brasiliaDayEnd, todayBrasiliaStr, type RawSearchParams } from "@/lib/filters";
import { requireTabAccess } from "@/lib/tabs";

const TIPO_LABEL: Record<string, string> = { sugestao: "Sugestão de contato", followup: "Follow-up pós-compra" };

function toDateInputValue(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

export default async function ContatosVendedoresPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "contatos-vendedores");

  const rawParams = await searchParams;
  const defaultFromStr = todayBrasiliaStr(new Date(Date.now() - 30 * 86400000));
  const fromStr = typeof rawParams.from === "string" && rawParams.from ? rawParams.from : defaultFromStr;
  const toStr = typeof rawParams.to === "string" && rawParams.to ? rawParams.to : todayBrasiliaStr(new Date());
  const from = brasiliaDayStart(fromStr);
  const to = brasiliaDayEnd(toStr);

  const { ranking, itens } = await getContatosPorVendedor(from, to);

  return (
    <div>
      <p className="mb-4 text-sm text-[var(--text-secondary)]">
        Contatos marcados na aba <a href="/dashboard/clientes-sugestoes-contato" className="underline">Sugestões de Contato</a> — marcação acontece
        sozinha no clique do link do WhatsApp, não é confirmação de entrega de verdade.
      </p>

      <form method="GET" className="mb-6 flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="from">De</label>
          <input id="from" type="date" name="from" defaultValue={toDateInputValue(from)} className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-primary)]" style={{ colorScheme: "light dark" }} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-muted)]" htmlFor="to">Até</label>
          <input id="to" type="date" name="to" defaultValue={toDateInputValue(to)} className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-primary)]" style={{ colorScheme: "light dark" }} />
        </div>
        <button type="submit" className="rounded-md bg-[var(--series-1)] px-3 py-1.5 text-sm font-medium text-white">Aplicar</button>
      </form>

      <div className="mb-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h3 className="border-b border-[var(--gridline)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)]">Ranking no período</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Vendedor</th>
              <th className="px-4 py-2 font-medium">Sugestões</th>
              <th className="px-4 py-2 font-medium">Follow-ups</th>
              <th className="px-4 py-2 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((r) => (
              <tr key={r.vendedor} className="border-b border-[var(--gridline)] last:border-0">
                <td className="px-4 py-2 font-medium">{r.vendedor}</td>
                <td className="px-4 py-2 tabular-nums">{r.sugestoes}</td>
                <td className="px-4 py-2 tabular-nums">{r.followUps}</td>
                <td className="px-4 py-2 font-medium tabular-nums">{r.total}</td>
              </tr>
            ))}
            {ranking.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-[var(--text-muted)]">Nenhum contato marcado nesse período.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h3 className="border-b border-[var(--gridline)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)]">Detalhe ({itens.length})</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Quando</th>
              <th className="px-4 py-2 font-medium">Vendedor</th>
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Tipo</th>
            </tr>
          </thead>
          <tbody>
            {itens.slice(0, 300).map((it, i) => (
              <tr key={`${it.tipo}-${it.cliente}-${it.chave}-${i}`} className="border-b border-[var(--gridline)] last:border-0">
                <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
                  {it.contatadoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
                </td>
                <td className="px-4 py-2">{it.contatadoPor}</td>
                <td className="px-4 py-2 font-medium">{it.cliente}</td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{TIPO_LABEL[it.tipo] ?? it.tipo}</td>
              </tr>
            ))}
            {itens.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-[var(--text-muted)]">Nenhum contato marcado nesse período.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
