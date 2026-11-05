import type { MetaInsight } from "@/lib/connectors/meta-ads";
import { formatBRL, formatNumber, formatPercent } from "@/lib/format";
import { AnuncioFotoCell } from "./anuncio-foto";

export type CampanhaRow = { nome: string } & MetaInsight;

// Item 3 da missão: investimento/impressões/cliques/CTR/CPC/CPM/conversões/ROAS — dois níveis
// (conjunto e anúncio), NUNCA misturados na mesma tabela. Esse componente só sabe desenhar UMA
// tabela; a página chama ele duas vezes com dados diferentes.
//
// `fotos` (refinamento visual da missão 2026-11-05) é OPCIONAL e só a página passa pra chamada
// "Por anúncio" — "Por conjunto" continua sem essa prop, então a coluna de imagem nem existe lá
// (9 colunas de sempre). Com `fotos`, vira 10 colunas.
export function CampanhaTable({
  titulo,
  nomeColuna,
  rows,
  fotos,
}: {
  titulo: string;
  nomeColuna: string;
  rows: CampanhaRow[];
  fotos?: Map<string, string[]>;
}) {
  const colCount = fotos ? 10 : 9;
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <h3 className="border-b border-[var(--gridline)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)]">{titulo}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              {fotos && <th className="px-4 py-2 font-medium">Foto</th>}
              <th className="px-4 py-2 font-medium">{nomeColuna}</th>
              <th className="px-4 py-2 font-medium text-right">Investimento</th>
              <th className="px-4 py-2 font-medium text-right">Impressões</th>
              <th className="px-4 py-2 font-medium text-right">Cliques</th>
              <th className="px-4 py-2 font-medium text-right">CTR</th>
              <th className="px-4 py-2 font-medium text-right">CPC</th>
              <th className="px-4 py-2 font-medium text-right">CPM</th>
              <th className="px-4 py-2 font-medium text-right">Compras</th>
              <th className="px-4 py-2 font-medium text-right">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.nome} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                {fotos && (
                  <td className="px-4 py-2">
                    <AnuncioFotoCell fotos={fotos.get(r.nome) ?? []} nome={r.nome} />
                  </td>
                )}
                <td className="max-w-[220px] truncate px-4 py-2 font-medium" title={r.nome}>{r.nome}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatBRL(r.gasto)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.impressoes)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.cliques)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{formatPercent(r.ctrPct)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{formatBRL(r.cpc)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{formatBRL(r.cpm)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNumber(r.compras)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.roas != null ? r.roas.toFixed(2) : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-[var(--text-muted)]">Sem investimento no período.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
