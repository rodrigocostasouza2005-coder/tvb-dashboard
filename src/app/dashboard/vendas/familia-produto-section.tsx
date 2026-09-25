"use client";

import { useMemo, useState } from "react";
import { IndicatorChart } from "../indicadores/indicator-chart";

const COR = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)", "var(--cat-7)", "var(--cat-8)"];
const MAX_COMPARAR = 8; // igual à paleta de cores — mais que isso já não dá pra ler no gráfico.

type MonthlySeries = {
  data: { month: string; revenue: Record<string, number>; units: Record<string, number> }[];
  series: string[];
};

type Visao = "faturamento" | "qtd";

function formatMoeda(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function top5PorValor(porFamilia: MonthlySeries, visao: Visao): string[] {
  const total = new Map(
    porFamilia.series.map((k) => [
      k,
      porFamilia.data.reduce((s, d) => s + ((visao === "qtd" ? d.units[k] : d.revenue[k]) ?? 0), 0),
    ])
  );
  return [...porFamilia.series].sort((a, b) => (total.get(b) ?? 0) - (total.get(a) ?? 0)).slice(0, 5);
}

// Seção "Vendas mensais por família / produto" — pedido do Rodrigo em 2026-09-25: hierarquia
// Família → Produto, tudo client-side (sem nenhuma navegação/reload). A visão Família já vem
// pronta do servidor (porFamilia, histórico completo já carregado); a visão Produto busca sob
// demanda em /api/vendas/produtos-familia só quando a família escolhida muda — cacheada em
// memória (produtosCache), então voltar pra uma família já vista não refaz a busca. Nenhuma
// interação aqui (trocar família/produto/métrica/comparar) refaz a página inteira nem perde a
// posição de scroll — é exatamente o "interação local → atualização local" pedido.
export function FamiliaProdutoSection({
  porFamilia,
  filtrosQuery,
}: {
  porFamilia: MonthlySeries;
  filtrosQuery: string; // querystring já pronta (store=...&marca=...&tabelaPreco=...) pra repassar pro fetch.
}) {
  const [analise, setAnalise] = useState<"familia" | "produto">("familia");
  const [visao, setVisao] = useState<Visao>("faturamento");
  const [familiasSelecionadas, setFamiliasSelecionadas] = useState<string[]>(() => top5PorValor(porFamilia, "faturamento"));

  const [familiaEscolhida, setFamiliaEscolhida] = useState<string | null>(null);
  const [produtosCache, setProdutosCache] = useState<Map<string, { produtos: string[] } & MonthlySeries>>(new Map());
  const [produtosSelecionados, setProdutosSelecionados] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const porProdutoAtual = familiaEscolhida ? produtosCache.get(familiaEscolhida) : undefined;

  async function escolherFamiliaParaProduto(familia: string) {
    setFamiliaEscolhida(familia);
    setErro(null);
    if (produtosCache.has(familia)) {
      const cached = produtosCache.get(familia)!;
      setProdutosSelecionados(top5PorValor(cached, visao));
      return;
    }
    setCarregando(true);
    try {
      const res = await fetch(`/api/vendas/produtos-familia?familia=${encodeURIComponent(familia)}&${filtrosQuery}`);
      if (!res.ok) throw new Error("Não consegui carregar os produtos dessa família.");
      const json = (await res.json()) as { produtos: string[]; data: MonthlySeries["data"]; series: string[] };
      const entry = { produtos: json.produtos, data: json.data, series: json.series };
      setProdutosCache((prev) => new Map(prev).set(familia, entry));
      setProdutosSelecionados(top5PorValor(entry, visao));
    } catch {
      setErro("Não consegui carregar os produtos dessa família. Tenta de novo.");
    } finally {
      setCarregando(false);
    }
  }

  function trocarAnalise(v: "familia" | "produto") {
    setAnalise(v);
    if (v === "produto" && !familiaEscolhida) {
      const primeira = top5PorValor(porFamilia, visao)[0] ?? porFamilia.series[0];
      if (primeira) escolherFamiliaParaProduto(primeira);
    }
  }

  function toggleFamilia(f: string) {
    setFamiliasSelecionadas((prev) => {
      if (prev.includes(f)) return prev.filter((x) => x !== f);
      if (prev.length >= MAX_COMPARAR) return prev;
      return [...prev, f];
    });
  }

  function toggleProduto(p: string) {
    setProdutosSelecionados((prev) => {
      if (prev.includes(p)) return prev.filter((x) => x !== p);
      if (prev.length >= MAX_COMPARAR) return prev;
      return [...prev, p];
    });
  }

  const fonte = analise === "familia" ? porFamilia : porProdutoAtual;
  const selecionados = analise === "familia" ? familiasSelecionadas : produtosSelecionados;

  const chartData = useMemo(() => {
    if (!fonte) return [];
    return fonte.data.map((d) => {
      const point: Record<string, string | number> = { month: d.month };
      for (const k of selecionados) point[k] = (visao === "qtd" ? d.units[k] : d.revenue[k]) ?? 0;
      return point;
    });
  }, [fonte, selecionados, visao]);

  const colunaLabel = analise === "familia" ? "Família" : "Produto";

  return (
    <section id="familia" className="mb-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="border-b border-[var(--gridline)] px-4 py-3">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">Vendas mensais por família / produto</h2>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          Histórico completo (não segue o filtro de data acima, só loja/marca/tabela de preço) — evolução mês a mês pra
          identificar crescimento, queda ou concentração de vendas.
        </p>
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-col gap-3 border-b border-[var(--gridline)] bg-[var(--page-plane)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <FiltroLinha label="Análise">
            <Segmented
              options={[{ value: "familia", label: "Família" }, { value: "produto", label: "Produto" }]}
              value={analise}
              onChange={(v) => trocarAnalise(v as "familia" | "produto")}
            />
          </FiltroLinha>

          {analise === "produto" && (
            <FiltroLinha label="Família">
              <select
                value={familiaEscolhida ?? ""}
                onChange={(e) => escolherFamiliaParaProduto(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
                style={{ colorScheme: "light dark" }}
              >
                {porFamilia.series.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </FiltroLinha>
          )}

          <FiltroLinha label="Métrica">
            <Segmented
              options={[{ value: "faturamento", label: "Faturamento" }, { value: "qtd", label: "Quantidade" }]}
              value={visao}
              onChange={(v) => setVisao(v as Visao)}
            />
          </FiltroLinha>
        </div>

        <FiltroLinha label={`Comparar ${analise === "familia" ? "famílias" : "produtos"} (até ${MAX_COMPARAR})`}>
          {carregando ? (
            <span className="text-xs text-[var(--text-muted)]">Carregando produtos...</span>
          ) : erro ? (
            <span className="text-xs text-[var(--status-critical)]">{erro}</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {(analise === "familia" ? porFamilia.series : (porProdutoAtual?.produtos ?? [])).map((item) => {
                const ativo = selecionados.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => (analise === "familia" ? toggleFamilia(item) : toggleProduto(item))}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      ativo
                        ? "border-[var(--series-1)] bg-[var(--series-1)] text-white"
                        : "border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
                    }`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
          )}
        </FiltroLinha>
      </div>

      {/* ── Gráfico ── */}
      <div className="border-b border-[var(--gridline)] p-4">
        <h3 className="mb-3 text-xs font-medium text-[var(--text-muted)]">Evolução mensal</h3>
        {selecionados.length > 0 && chartData.length > 0 ? (
          <IndicatorChart
            data={chartData}
            format={visao === "qtd" ? "number" : "currency"}
            series={selecionados.map((k, i) => ({ key: k, name: k, color: COR[i % COR.length] }))}
          />
        ) : (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            {carregando ? "Carregando..." : `Selecione ao menos ${colunaLabel.toLowerCase()} um pra comparar acima.`}
          </p>
        )}
      </div>

      {/* ── Tabela ── */}
      <div className="p-4">
        <h3 className="mb-3 text-xs font-medium text-[var(--text-muted)]">Histórico mensal</h3>
        {selecionados.length > 0 && fonte && fonte.data.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-[var(--gridline)]">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-[var(--gridline)] bg-[var(--page-plane)] text-left text-[var(--text-muted)]">
                  <th className="sticky left-0 z-10 bg-[var(--page-plane)] px-4 py-2 font-medium">{colunaLabel}</th>
                  {fonte.data.map((d) => (
                    <th key={d.month} className="px-4 py-2 text-right font-medium whitespace-nowrap">{d.month}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selecionados.map((k) => (
                  <tr key={k} className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
                    <td className="sticky left-0 z-10 bg-[var(--surface-1)] px-4 py-2 font-medium whitespace-nowrap text-[var(--text-primary)]">{k}</td>
                    {fonte.data.map((d) => {
                      const v = (visao === "qtd" ? d.units[k] : d.revenue[k]) ?? 0;
                      return (
                        <td key={d.month} className="px-4 py-2 text-right tabular-nums whitespace-nowrap text-[var(--text-secondary)]">
                          {v > 0 ? (visao === "qtd" ? v.toLocaleString("pt-BR") : formatMoeda(v)) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">Sem dados suficientes no filtro selecionado.</p>
        )}
      </div>
    </section>
  );
}

function FiltroLinha({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium tracking-wide text-[var(--text-muted)] uppercase">{label}</span>
      {children}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-[var(--border)] text-xs">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 ${
            value === opt.value ? "bg-[var(--series-1)] text-white" : "bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
