"use client";

import { useState } from "react";
import type { MetaInsight } from "@/lib/connectors/meta-ads";
import { FotoGaleria } from "./foto-galeria";

export type InvestimentoRow = MetaInsight & { nome: string; fotos: string[]; ativo: boolean };

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Toggle Conjunto/Criativo — pedido do Rodrigo em 2026-09-28. Os dois conjuntos de linhas já vêm
// prontos do server (page.tsx busca os dois níveis de insight do Meta de uma vez), troca é só
// estado local, sem round-trip.
export function InvestimentoMetaAds({
  porConjunto,
  porCriativo,
}: {
  porConjunto: InvestimentoRow[];
  porCriativo: InvestimentoRow[];
}) {
  const [modo, setModo] = useState<"conjunto" | "criativo">("conjunto");
  // Só ativos ligado por padrão — pedido do Rodrigo em 2026-09-28 ("eu quero só os ativos"). O
  // selo de status em cada linha continua visível mesmo com o filtro desligado, pra quem quiser
  // ver o histórico completo (ex: conjunto que gastou a semana toda e foi pausado hoje).
  const [soAtivos, setSoAtivos] = useState(true);
  const base = modo === "conjunto" ? porConjunto : porCriativo;
  const linhas = soAtivos ? base.filter((l) => l.ativo) : base;
  const rotulo = modo === "conjunto" ? "Conjunto" : "Criativo";

  return (
    <section className="mb-10 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--gridline)] px-4 py-2.5">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">Investimento por {rotulo.toLowerCase()} (Meta Ads)</h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <input type="checkbox" checked={soAtivos} onChange={(e) => setSoAtivos(e.target.checked)} />
            Só ativos
          </label>
          <div className="flex overflow-hidden rounded-md border border-[var(--border)] text-xs">
            {(["conjunto", "criativo"] as const).map((opcao) => (
              <button
                key={opcao}
                type="button"
                onClick={() => setModo(opcao)}
                className="px-3 py-1 font-medium capitalize"
                style={{
                  backgroundColor: modo === opcao ? "var(--series-1)" : "var(--surface-1)",
                  color: modo === opcao ? "white" : "var(--text-secondary)",
                }}
              >
                {opcao}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="px-4 pt-2 text-xs text-[var(--text-muted)]">
        Top 15 {modo === "conjunto" ? "conjuntos" : "criativos"} por gasto no período. ROAS é o
        retorno calculado pelo próprio Meta (receita atribuída ao pixel ÷ gasto) — números de
        sessão/conversão do GA4 acima podem divergir um pouco, já que cada plataforma atribui a
        venda de um jeito diferente.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">{rotulo}</th>
              <th className="px-4 py-2 font-medium">Foto</th>
              <th className="px-4 py-2 font-medium text-right">Gasto</th>
              <th className="px-4 py-2 font-medium text-right">Cliques</th>
              <th className="px-4 py-2 font-medium text-right">CTR</th>
              <th className="px-4 py-2 font-medium text-right">CPC</th>
              <th className="px-4 py-2 font-medium text-right">CPM</th>
              <th className="px-4 py-2 font-medium text-right">Compras</th>
              <th className="px-4 py-2 font-medium text-right">Custo/compra</th>
              <th className="px-4 py-2 font-medium text-right">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((i) => (
              <tr key={i.nome} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                <td className="px-4 py-2 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: i.ativo ? "var(--status-good)" : "var(--text-muted)" }}
                    />
                    {i.nome}
                    <span className="text-xs font-normal text-[var(--text-muted)]">
                      {i.ativo ? "Ativo" : "Pausado"}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2">
                  <FotoGaleria fotos={i.fotos} label={i.nome} />
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">{formatBRL(i.gasto)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{i.cliques.toLocaleString("pt-BR")}</td>
                <td className="px-4 py-2 text-right tabular-nums">{i.ctrPct.toFixed(2)}%</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatBRL(i.cpc)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatBRL(i.cpm)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{i.compras.toLocaleString("pt-BR")}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {i.custoPorCompra != null ? formatBRL(i.custoPorCompra) : "—"}
                </td>
                <td
                  className="px-4 py-2 text-right tabular-nums font-medium"
                  style={{ color: i.roas != null && i.roas >= 1 ? "var(--status-good)" : "var(--status-critical)" }}
                >
                  {i.roas != null ? `${i.roas.toFixed(2)}x` : "—"}
                </td>
              </tr>
            ))}
            {linhas.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  Sem dado de investimento no período (ou Meta Ads não conectado).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
