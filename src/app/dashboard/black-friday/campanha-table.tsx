import type { AtivoStatus, MetaInsight } from "@/lib/connectors/meta-ads";
import { formatBRL, formatNumber, formatPercent } from "@/lib/format";
import { AnuncioFotoCell } from "./anuncio-foto";

export type CampanhaRow = { nome: string } & MetaInsight;

// Decide cor do ponto + rótulo do selo a partir do Map de status. Extraída como função pura (em
// vez de inline no JSX) pra dar pra testar sem renderizar o componente — este repo não tem
// jsdom/testing-library configurado (ver vitest.config.ts, environment: "node"), então a
// convenção aqui é sempre extrair a decisão em si, não o componente inteiro. Nome ausente do Map
// (`undefined`) cai no mesmo visual de "Pausado" — mesma regra de antes do PR #58.
//
// Pedido do Rodrigo em 2026-11-09: nome com várias cópias (ids) em campanhas diferentes e status
// misto (1 ativa + 2 pausadas, por exemplo) não pode virar um "Ativo" liso igual a uma cópia só —
// isso escondia a mistura. `status.total > 1` e nem tudo ativo nem tudo pausado -> selo de alerta
// com a contagem ("Ativo em 1/3"), pra ficar visível que não é unânime.
export function badgeAtivoPausado(status: AtivoStatus | undefined): { cor: string; label: string } {
  if (!status || status.ativos === 0) return { cor: "var(--text-muted)", label: "Pausado" };
  if (status.ativos === status.total) return { cor: "var(--status-good)", label: "Ativo" };
  return { cor: "var(--status-warning)", label: `Ativo em ${status.ativos}/${status.total}` };
}

// Item 3 da missão: investimento/impressões/cliques/CTR/CPC/CPM/conversões/ROAS — dois níveis
// (conjunto e anúncio), NUNCA misturados na mesma tabela. Esse componente só sabe desenhar UMA
// tabela; a página chama ele duas vezes com dados diferentes.
//
// `fotos` (refinamento visual da missão 2026-11-05) é OPCIONAL e só a página passa pra chamada
// "Por anúncio" — "Por conjunto" continua sem essa prop, então a coluna de imagem nem existe lá
// (9 colunas de sempre). Com `fotos`, vira 10 colunas.
//
// `ativoPorNome` (pedido do Rodrigo em 2026-11-06 — "saber quais criativos estão rodando de
// verdade", e de novo no mesmo dia depois de uma rodada curta filtrando pausado pra fora: "volta
// o selo, mas mostrando todos") é OPCIONAL e, diferente de `fotos`, se aplica tanto a "Por
// conjunto" quanto "Por anúncio": campanha/conjunto pausado existe tanto quanto anúncio pausado.
// Vem do effective_status real do Meta (ver getAtivoPorNomeConjunto/getAtivoPorNomeAnuncio em
// connectors/meta-ads.ts), não do `status` isolado — por isso é um Map calculado pela página, não
// um campo de MetaInsight (que só sabe de gasto/métrica, nunca viu adset/campanha pai). `rows` NÃO
// é filtrado por status — mostra ativo e pausado juntos, só sinalizados; o selo (ponto + rótulo)
// usa o mesmo padrão visual já em analytics-site/investimento-meta-ads.tsx, embutido na coluna do
// nome (não uma coluna nova), pra não desalinhar as duas tabelas quando só uma delas tiver o dado
// disponível (`ativoPorNome` undefined — ver statusAtivoIndisponivel em ./campanhas-ativas.ts).
export function CampanhaTable({
  titulo,
  nomeColuna,
  rows,
  fotos,
  ativoPorNome,
}: {
  titulo: string;
  nomeColuna: string;
  rows: CampanhaRow[];
  fotos?: Map<string, string[]>;
  ativoPorNome?: Map<string, AtivoStatus>;
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
                <td className="max-w-[420px] truncate px-4 py-2 font-medium" title={r.nome}>
                  {ativoPorNome ? (
                    (() => {
                      const { cor, label } = badgeAtivoPausado(ativoPorNome.get(r.nome));
                      return (
                        <span className="inline-flex items-center gap-1.5">
                          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: cor }} />
                          <span className="truncate">{r.nome}</span>
                          <span className="shrink-0 text-xs font-normal text-[var(--text-muted)]">{label}</span>
                        </span>
                      );
                    })()
                  ) : (
                    r.nome
                  )}
                </td>
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
