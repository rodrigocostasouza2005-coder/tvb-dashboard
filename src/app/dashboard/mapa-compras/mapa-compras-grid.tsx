"use client";

import { useState } from "react";
import { TipoCompraProduto } from "@prisma/client";
import { updateCoberturaMetaAction } from "./actions";
import { ConfirmarDecisaoForm } from "./inteligencia/forms";
import type { GrupoMatriz, ProdutoMatriz } from "./matriz-helpers";
import type { TamanhoBreakdownRow } from "@/lib/metrics";

type MesLinha = GrupoMatriz["meses"][number];

const MES_NOMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
function formatMes(mes: string) {
  const [y, m] = mes.split("-");
  return `${MES_NOMES[parseInt(m) - 1]}/${y.slice(2)}`;
}

const METRICAS: { key: keyof MesLinha; label: string; destaque?: boolean; decimal?: boolean }[] = [
  { key: "estoqueInicial", label: "Estoque inicial" },
  { key: "recebimento", label: "Recebimento" },
  { key: "vendas", label: "Vendas (líquido)" },
  { key: "bonificacoes", label: "Bonificações" },
  { key: "estoqueFinal", label: "Estoque final", destaque: true },
  { key: "estoqueIdeal", label: "Estoque ideal (cobertura)" },
  { key: "coberturaAtual", label: "Cobertura (meses)", decimal: true },
  { key: "faltaComprar", label: "Falta comprar", destaque: true },
];

function Celula({ valor, mes, metrica }: { valor: number | null; mes: MesLinha; metrica: (typeof METRICAS)[number] }) {
  const isFalta = metrica.key === "faltaComprar";
  const vazio =
    valor === null ||
    (valor === 0 && (isFalta || (mes.tipo === "realizado" ? metrica.key !== "estoqueFinal" && metrica.key !== "estoqueInicial" : false)));
  return (
    <td
      className="min-w-[76px] border-b border-[var(--gridline)] px-2 py-1.5 text-right text-xs tabular-nums"
      style={{
        backgroundColor: mes.tipo === "projetado" ? "color-mix(in srgb, var(--series-1) 4%, transparent)" : undefined,
        color: isFalta && (valor ?? 0) > 0 ? "var(--status-critical)" : metrica.destaque ? "var(--text-primary)" : "var(--text-secondary)",
        fontWeight: metrica.destaque ? 600 : 400,
      }}
    >
      {vazio ? (
        <span className="text-[var(--text-muted)]">—</span>
      ) : metrica.decimal ? (
        valor!.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      ) : (
        valor!.toLocaleString("pt-BR")
      )}
    </td>
  );
}

function BlocoLinhas({ meses, indent = false }: { meses: MesLinha[]; indent?: boolean }) {
  return (
    <>
      {METRICAS.map((metrica) => (
        <tr key={metrica.label} className="hover:bg-[var(--page-plane)]">
          <td
            className={`sticky left-0 z-10 border-b border-[var(--gridline)] bg-[var(--surface-1)] px-3 py-1.5 text-xs whitespace-nowrap ${indent ? "pl-8 text-[var(--text-muted)]" : "text-[var(--text-secondary)]"}`}
          >
            {metrica.label}
          </td>
          {meses.map((mes) => (
            <Celula key={mes.mes} valor={mes[metrica.key] as number | null} mes={mes} metrica={metrica} />
          ))}
        </tr>
      ))}
    </>
  );
}

function Badge({ cor, children, title }: { cor: string; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${cor} 15%, transparent)`, color: cor }}
    >
      {children}
    </span>
  );
}

// Linha de recomendação (não é mês nenhum — é o número explicável que vem da Inteligência de
// Compras, horizonte/orçamento, separado da grade mês a mês) + premissas/avisos num <details>
// nativo (sem JS extra) + a ação de confirmar decisão humana (seção 9), reaproveitada tal como já
// existia.
function LinhaRecomendacao({ tipo, grupoNome, produto, mesesHeader, canEdit }: { tipo: TipoCompraProduto; grupoNome: string; produto: ProdutoMatriz; mesesHeader: string[]; canEdit: boolean }) {
  const r = produto.recomendacao;
  return (
    <tr>
      <td className="sticky left-0 z-10 bg-[var(--page-plane)] px-3 py-1.5 pl-8" colSpan={1}>
        <div className="flex flex-wrap items-center gap-1.5">
          {produto.divergente && (
            <Badge cor="var(--status-warning)" title="Os tamanhos deste produto têm classificações diferentes entre si (Best Seller/Drop) — mostrado no lado que teve mais receita.">
              classificação divergente por tamanho
            </Badge>
          )}
          {r == null ? (
            <span className="text-[10px] text-[var(--text-muted)]">Sem dado suficiente pra calcular recomendação.</span>
          ) : tipo === TipoCompraProduto.BEST_SELLER ? (
            <>
              <Badge cor={!r.confiavel ? "var(--status-warning)" : "var(--status-good)"}>
                Sugestão de compra: {r.quantidadeSugerida.toLocaleString("pt-BR")} un{r.valorEstimado != null ? ` (R$ ${r.valorEstimado.toLocaleString("pt-BR", { maximumFractionDigits: 0 })})` : ""}
              </Badge>
              {r.coberturaAtualDias != null && (
                <span className="text-[10px] text-[var(--text-muted)]">cobertura atual: {r.coberturaAtualDias.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}d</span>
              )}
            </>
          ) : (
            <>
              {r.sellThroughAtual != null && (
                <Badge cor="var(--text-secondary)">Sell-through: {r.sellThroughAtual.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</Badge>
              )}
              {r.riscoRuptura && <Badge cor="var(--status-critical)">Risco de ruptura</Badge>}
              {r.riscoSobra && <Badge cor="var(--status-warning)">Risco de sobra</Badge>}
              {r.bloqueadoRecompra && <Badge cor="var(--text-muted)">Recompra bloqueada</Badge>}
              {r.precisaConfirmacaoHumana && <Badge cor="var(--status-warning)">Precisa confirmação</Badge>}
              {!r.bloqueadoRecompra && r.quantidadeSugerida > 0 && (
                <Badge cor="var(--status-good)">
                  Sugestão: {r.quantidadeSugerida.toLocaleString("pt-BR")} un{r.valorEstimado != null ? ` (R$ ${r.valorEstimado.toLocaleString("pt-BR", { maximumFractionDigits: 0 })})` : ""}
                </Badge>
              )}
            </>
          )}
          {r != null && (r.premissas.length > 0 || r.avisos.length > 0) && (
            <details className="inline-block">
              <summary className="cursor-pointer text-[10px] text-[var(--text-muted)] underline">premissas/avisos</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10px] text-[var(--text-muted)]">
                {[...r.premissas, ...r.avisos].map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </details>
          )}
          {canEdit && r != null && !r.bloqueadoRecompra && r.quantidadeSugerida > 0 && (
            // cods[0]: quando o produto tem mais de 1 tamanho/SKU classificado, a decisão grava
            // contra o primeiro cod como representante — a quantidade aprovada já é a soma de
            // todos os tamanhos (ver agregarBestSeller/agregarDrop em matriz-helpers.ts).
            <ConfirmarDecisaoForm
              cod={produto.cods[0]}
              grupo={grupoNome}
              tipoCompra={tipo}
              quantidadeSugerida={r.quantidadeSugerida}
              premissas={{ premissas: r.premissas, avisos: r.avisos }}
            />
          )}
        </div>
      </td>
      {mesesHeader.map((mes) => (
        <td key={mes} className="bg-[var(--page-plane)]" />
      ))}
    </tr>
  );
}

function TamanhoLinha({ linhas, mesesHeader }: { linhas: TamanhoBreakdownRow[]; mesesHeader: string[] }) {
  return (
    <tr>
      <td className="sticky left-0 z-10 bg-[var(--surface-1)] px-3 py-1.5 pl-10" colSpan={1}>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
          {linhas.length === 0 ? (
            <span className="text-[var(--text-muted)]">Sem detalhe por tamanho.</span>
          ) : (
            linhas.map((l) => (
              <span key={l.tamanho} className="whitespace-nowrap rounded-md border border-[var(--gridline)] px-1.5 py-0.5">
                <strong>{l.tamanho}</strong>: estoque {l.estoque.toLocaleString("pt-BR")} · vendido {l.vendido.toLocaleString("pt-BR")}
              </span>
            ))
          )}
        </div>
      </td>
      {mesesHeader.map((mes) => (
        <td key={mes} className="bg-[var(--surface-1)]" />
      ))}
    </tr>
  );
}

function ProdutoBloco({
  tipo,
  grupoNome,
  produto,
  mesesHeader,
  canEdit,
  tamanhoPorProduto,
}: {
  tipo: TipoCompraProduto;
  grupoNome: string;
  produto: ProdutoMatriz;
  mesesHeader: string[];
  canEdit: boolean;
  tamanhoPorProduto: Map<string, TamanhoBreakdownRow[]>;
}) {
  const [abertoTamanho, setAbertoTamanho] = useState(false);
  const tamanhos = tamanhoPorProduto.get(produto.produto) ?? [];

  return (
    <>
      <tr>
        <td className="sticky left-0 z-10 bg-[var(--page-plane)] px-3 py-1.5 pl-6 text-xs font-medium whitespace-nowrap text-[var(--text-primary)]" colSpan={1}>
          <button type="button" onClick={() => setAbertoTamanho((v) => !v)} className="flex items-center gap-1.5">
            <span className="inline-block w-3 text-[var(--text-muted)] transition-transform" style={{ transform: abertoTamanho ? "rotate(90deg)" : "rotate(0deg)" }}>
              ▸
            </span>
            {produto.produto}
            {tamanhos.length > 0 && <span className="text-[10px] font-normal text-[var(--text-muted)]">({tamanhos.length} tam.)</span>}
          </button>
        </td>
        {mesesHeader.map((mes) => (
          <td key={mes} className="bg-[var(--page-plane)]" />
        ))}
      </tr>
      {abertoTamanho && <TamanhoLinha linhas={tamanhos} mesesHeader={mesesHeader} />}
      <LinhaRecomendacao tipo={tipo} grupoNome={grupoNome} produto={produto} mesesHeader={mesesHeader} canEdit={canEdit} />
      <BlocoLinhas meses={produto.meses} indent />
    </>
  );
}

function GrupoBloco({
  tipo,
  grupo,
  mesesHeader,
  canEdit,
  tamanhoPorProduto,
}: {
  tipo: TipoCompraProduto;
  grupo: GrupoMatriz;
  mesesHeader: string[];
  canEdit: boolean;
  tamanhoPorProduto: Map<string, TamanhoBreakdownRow[]>;
}) {
  const [aberto, setAberto] = useState(false);
  const faltaTotal = grupo.meses.reduce((s, m) => s + m.faltaComprar, 0);

  return (
    <>
      <tr className="border-t-2 border-[var(--border)]">
        <td className="sticky left-0 z-10 bg-[var(--surface-1)] px-3 py-2" colSpan={1}>
          <button type="button" onClick={() => setAberto((v) => !v)} className="flex items-center gap-1.5 text-left text-sm font-semibold text-[var(--text-primary)]">
            <span className="inline-block w-3 text-[var(--text-muted)] transition-transform" style={{ transform: aberto ? "rotate(90deg)" : "rotate(0deg)" }}>
              ▸
            </span>
            {grupo.grupo}
            <span className="text-xs font-normal text-[var(--text-muted)]">({grupo.produtos.length})</span>
          </button>
        </td>
        {mesesHeader.map((mes, i) => (
          <td key={mes} className="bg-[var(--surface-1)] px-2 py-2">
            {i === 0 && canEdit && (
              <form action={updateCoberturaMetaAction} className="flex items-center gap-1 whitespace-nowrap">
                <input type="hidden" name="grupo" value={grupo.grupo} />
                <span className="text-[10px] text-[var(--text-muted)]">Cobertura</span>
                <input
                  type="number"
                  name="mesesCobertura"
                  defaultValue={grupo.coberturaMeses}
                  min={0.1}
                  step={0.1}
                  className="w-12 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-1 py-0.5 text-right text-[10px] tabular-nums text-[var(--text-primary)]"
                />
                <button type="submit" className="rounded-md border border-[var(--border)] px-1 text-[10px] text-[var(--text-muted)] hover:bg-[var(--page-plane)]" title="Salvar">
                  ✓
                </button>
              </form>
            )}
            {i === 0 && !canEdit && (
              <span className="text-[10px] whitespace-nowrap text-[var(--text-muted)]">Cobertura {grupo.coberturaMeses.toLocaleString("pt-BR")} meses</span>
            )}
            {i === 1 && faltaTotal > 0 && <Badge cor="var(--status-critical)">falta {faltaTotal.toLocaleString("pt-BR")} no total</Badge>}
          </td>
        ))}
      </tr>
      <BlocoLinhas meses={grupo.meses} />
      {aberto &&
        grupo.produtos.map((produto) => (
          <ProdutoBloco key={produto.produto} tipo={tipo} grupoNome={grupo.grupo} produto={produto} mesesHeader={mesesHeader} canEdit={canEdit} tamanhoPorProduto={tamanhoPorProduto} />
        ))}
    </>
  );
}

function SecaoBloco({
  tipo,
  label,
  cor,
  grupos,
  mesesHeader,
  canEdit,
  tamanhoPorProduto,
  buscaAtiva,
}: {
  tipo: TipoCompraProduto;
  label: string;
  cor: string;
  grupos: GrupoMatriz[];
  mesesHeader: string[];
  canEdit: boolean;
  tamanhoPorProduto: Map<string, TamanhoBreakdownRow[]>;
  buscaAtiva: string;
}) {
  const [aberto, setAberto] = useState(true);
  const buscaLower = buscaAtiva.trim().toLowerCase();
  const gruposFiltrados = buscaLower
    ? grupos
        .map((g) => ({ ...g, produtos: g.produtos.filter((p) => p.produto.toLowerCase().includes(buscaLower) || p.cods.some((c) => c.toLowerCase().includes(buscaLower))) }))
        .filter((g) => g.produtos.length > 0)
    : grupos;
  const totalProdutos = gruposFiltrados.reduce((s, g) => s + g.produtos.length, 0);

  return (
    <div className="mb-6">
      <button type="button" onClick={() => setAberto((v) => !v)} className="mb-2 flex items-center gap-2">
        <span className="inline-block w-3 text-[var(--text-muted)] transition-transform" style={{ transform: aberto ? "rotate(90deg)" : "rotate(0deg)" }}>
          ▸
        </span>
        <h2 className="text-sm font-bold tracking-wide uppercase" style={{ color: cor }}>
          {label}
        </h2>
        <span className="text-xs text-[var(--text-muted)]">({totalProdutos} produto{totalProdutos !== 1 ? "s" : ""})</span>
      </button>
      {aberto && (
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]" style={{ borderTopColor: cor, borderTopWidth: 3 }}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 min-w-[220px] border-b border-[var(--gridline)] bg-[var(--surface-1)] px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">
                  Grupo / Produto
                </th>
                {mesesHeader.map((mes) => {
                  const tipoMes = gruposFiltrados[0]?.meses.find((m) => m.mes === mes)?.tipo;
                  return (
                    <th
                      key={mes}
                      className="sticky top-0 z-10 min-w-[76px] border-b border-[var(--gridline)] px-2 py-2 text-right text-xs font-medium whitespace-nowrap text-[var(--text-muted)]"
                      style={{ backgroundColor: tipoMes === "projetado" ? "color-mix(in srgb, var(--series-1) 8%, var(--surface-1))" : "var(--surface-1)" }}
                    >
                      {formatMes(mes)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {gruposFiltrados.map((grupo) => (
                <GrupoBloco key={grupo.grupo} tipo={tipo} grupo={grupo} mesesHeader={mesesHeader} canEdit={canEdit} tamanhoPorProduto={tamanhoPorProduto} />
              ))}
              {gruposFiltrados.length === 0 && (
                <tr>
                  <td colSpan={mesesHeader.length + 1} className="px-4 py-6 text-center text-[var(--text-muted)]">
                    Nenhum produto {label.toLowerCase()} no filtro atual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function MatrizCompras({
  bestSeller,
  drop,
  canEdit,
  tamanhoPorProduto,
  busca,
}: {
  bestSeller: GrupoMatriz[];
  drop: GrupoMatriz[];
  canEdit: boolean;
  tamanhoPorProduto: Map<string, TamanhoBreakdownRow[]>;
  busca: string;
}) {
  const mesesHeader = (bestSeller[0] ?? drop[0])?.meses.map((m) => m.mes) ?? [];

  return (
    <div>
      <SecaoBloco
        tipo={TipoCompraProduto.BEST_SELLER}
        label="Best Seller"
        cor="var(--series-1)"
        grupos={bestSeller}
        mesesHeader={mesesHeader}
        canEdit={canEdit}
        tamanhoPorProduto={tamanhoPorProduto}
        buscaAtiva={busca}
      />
      <SecaoBloco
        tipo={TipoCompraProduto.DROP}
        label="Drop"
        cor="var(--series-2)"
        grupos={drop}
        mesesHeader={mesesHeader}
        canEdit={canEdit}
        tamanhoPorProduto={tamanhoPorProduto}
        buscaAtiva={busca}
      />
    </div>
  );
}
