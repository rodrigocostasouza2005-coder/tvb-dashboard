import { StatTile } from "../../stat-tile";
import { formatMoeda, formatNumero, formatPct } from "../inteligencia/format";
import type { VisaoAnaliticaResultado, RecomendacaoBestSellerPorProduto, RecomendacaoDropPorProduto } from "@/lib/metrics";
import { GradeChart } from "./grade-chart";
import { BestSellerChart } from "./best-seller-chart";

const SITUACAO_LABEL: Record<string, { label: string; tom: "good" | "warning" | "critical" | "serious" }> = {
  ruptura: { label: "Ruptura", tom: "critical" },
  ajustar: { label: "Ajustar", tom: "warning" },
  equilibrio: { label: "Equilíbrio", tom: "good" },
  excesso: { label: "Excesso", tom: "serious" },
};

const TOM_COR: Record<string, string> = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  critical: "var(--status-critical)",
  serious: "var(--status-serious)",
};

function Badge({ situacao }: { situacao: string }) {
  const info = SITUACAO_LABEL[situacao] ?? SITUACAO_LABEL.equilibrio;
  const cor = TOM_COR[info.tom];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: `color-mix(in srgb, ${cor} 18%, transparent)`, color: cor }}
    >
      {info.label}
    </span>
  );
}

// Visão Analítica (seções 5.2, 5.3, 5.4, 5.5, 5.6, 5.7 do briefing) — KPIs, grade por tamanho,
// Best Seller x Não, tabela detalhada, insights e resumo da compra. Server Component: os dados já
// vêm prontos de page.tsx (getVisaoAnaliticaMapaCompras), só os 2 gráficos (recharts) são client.
export function VisaoAnaliticaView({
  resultado,
  bsRows,
  dropRows,
  nomeEscopo,
}: {
  resultado: VisaoAnaliticaResultado;
  bsRows: RecomendacaoBestSellerPorProduto[];
  dropRows: RecomendacaoDropPorProduto[];
  nomeEscopo: string;
}) {
  const { kpis, porTamanho, bestSellerVsNao, insights } = resultado;

  // Resumo da compra (seção 5.7) reaproveita as MESMAS recomendações já calculadas pela
  // Inteligência de Compras (bsRows/dropRows) — nunca um 2º cálculo divergente. Filtrado só por
  // grupo (já embutido em bsRows/dropRows via page.tsx) — SugestaoBestSeller/Drop são
  // recomendações consolidadas da empresa, sem granularidade de loja/tamanho pra filtrar além
  // disso (mesma limitação que já existe hoje na aba Planejamento Mensal).
  const totalPecasSugeridas = bsRows.reduce((s, r) => s + r.quantidadeSugerida, 0) + dropRows.reduce((s, r) => s + (r.quantidadeSugerida ?? 0), 0);
  const valorEstimadoResumo =
    bsRows.reduce((s, r) => s + (r.valorEstimado ?? 0), 0) + dropRows.reduce((s, r) => s + (r.valorEstimado ?? 0), 0);
  const produtosQuePrecisamReposicao = bsRows.filter((r) => r.quantidadeSugerida > 0).length + dropRows.filter((r) => (r.quantidadeSugerida ?? 0) > 0).length;
  const produtosCriticos = bsRows.filter((r) => r.coberturaAtualDias != null && r.coberturaAtualDias < 7).length + dropRows.filter((r) => r.riscoRuptura).length;
  const produtosComExcesso = dropRows.filter((r) => r.riscoSobra).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile label="COMPRA SUGERIDA" value={`${formatNumero(kpis.compraSugeridaTotal)} un.`} />
        <StatTile label="ESTOQUE DISPONÍVEL" value={`${formatNumero(kpis.estoqueDisponivel)} un.`} />
        <StatTile label="ESTOQUE IDEAL" value={`${formatNumero(kpis.estoqueIdeal)} un.`} />
        <StatTile
          label="COBERTURA ATUAL"
          value={kpis.coberturaMediaDias != null ? `${formatNumero(kpis.coberturaMediaDias, 1)} dias` : "—"}
          subValue="média ponderada do recorte"
        />
        <StatTile label="VALOR ESTIMADO DA COMPRA" value={formatMoeda(kpis.valorEstimadoCompra)} status={kpis.valorEstimadoCompra > 0 ? "warning" : undefined} />
        <StatTile
          label="PRODUTOS EM RISCO DE RUPTURA"
          value={String(kpis.produtosEmRupturaCount)}
          status={kpis.produtosEmRupturaCount > 0 ? "critical" : "good"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <h2 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">Distribuição da Grade</h2>
          <GradeChart linhas={porTamanho} />
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[var(--text-muted)]">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "var(--status-critical)" }} /> Ruptura</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "var(--status-warning)" }} /> Ajustar</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "var(--status-good)" }} /> Equilíbrio</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "var(--status-serious)" }} /> Excesso</span>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <h2 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">Best Seller x Não Best Seller</h2>
          <BestSellerChart linhas={bestSellerVsNao} />
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">
            Best Seller prioriza reposição contínua e prevenção de ruptura; Não Best Seller prioriza giro e compra conservadora.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <h2 className="px-4 pt-4 text-sm font-medium text-[var(--text-secondary)]">Detalhamento por Tamanho</h2>
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Tamanho</th>
              <th className="px-4 py-2 text-right font-medium">Venda Histórica</th>
              <th className="px-4 py-2 text-right font-medium">Participação</th>
              <th className="px-4 py-2 text-right font-medium">Estoque Atual</th>
              <th className="px-4 py-2 text-right font-medium">Estoque Ideal</th>
              <th className="px-4 py-2 text-right font-medium">Compra Sugerida</th>
              <th className="px-4 py-2 text-left font-medium">Situação</th>
            </tr>
          </thead>
          <tbody>
            {porTamanho.map((l) => (
              <tr key={l.tamanho} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                <td className="px-4 py-2 font-semibold tabular-nums text-[var(--text-primary)]">{l.tamanho}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{formatNumero(l.vendaHistorica)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{formatPct(l.participacaoPct * 100)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{formatNumero(l.estoqueAtual)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--text-secondary)]">{formatNumero(l.estoqueIdeal)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold text-[var(--text-primary)]">{formatNumero(l.compraSugerida)}</td>
                <td className="px-4 py-2">
                  <Badge situacao={l.situacao} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
            <span style={{ color: "var(--status-warning)" }}>◆</span> Insights do Mapa
          </h2>
          {insights.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">Sem insights suficientes para este recorte.</p>
          ) : (
            <ul className="space-y-1.5 text-xs text-[var(--text-secondary)]">
              {insights.map((i, idx) => (
                <li key={idx} className="flex gap-1.5">
                  <span style={{ color: "var(--status-good)" }}>✓</span>
                  {i}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <h2 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">Resumo da Compra</h2>
          <div className="text-2xl font-semibold tabular-nums text-[var(--text-primary)]">{formatNumero(totalPecasSugeridas)} un.</div>
          <div className="text-xs text-[var(--text-muted)]">{formatMoeda(valorEstimadoResumo)} estimado</div>
          <div className="mt-3 text-xs text-[var(--text-secondary)]">
            {produtosQuePrecisamReposicao} produto(s) com reposição necessária · {produtosCriticos} crítico(s) · {produtosComExcesso} com excesso
          </div>
        </div>
      </div>
    </div>
  );
}
