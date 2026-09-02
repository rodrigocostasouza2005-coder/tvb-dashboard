"use client";

import { useState } from "react";
import { updateCoberturaMetaAction } from "./actions";

type MesLinha = {
  mes: string;
  tipo: "realizado" | "projetado";
  estoqueInicial: number;
  recebimento: number;
  vendas: number;
  bonificacoes: number;
  estoqueFinal: number;
  estoqueIdeal: number;
  faltaComprar: number;
};

type ProdutoLinha = { produto: string; meses: MesLinha[] };
type GrupoLinha = { grupo: string; coberturaMeses: number; meses: MesLinha[]; produtos: ProdutoLinha[] };

const MES_NOMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
function formatMes(mes: string) {
  const [y, m] = mes.split("-");
  return `${MES_NOMES[parseInt(m) - 1]}/${y.slice(2)}`;
}

const METRICAS: { key: keyof MesLinha; label: string; destaque?: boolean }[] = [
  { key: "estoqueInicial", label: "Estoque inicial" },
  { key: "recebimento", label: "Recebimento (produção)" },
  { key: "vendas", label: "Vendas (líquido)" },
  { key: "bonificacoes", label: "Bonificações" },
  { key: "estoqueFinal", label: "Estoque final", destaque: true },
  { key: "estoqueIdeal", label: "Estoque ideal (cobertura)" },
  { key: "faltaComprar", label: "Falta comprar", destaque: true },
];

function Celula({ valor, mes, metrica }: { valor: number; mes: MesLinha; metrica: (typeof METRICAS)[number] }) {
  const isFalta = metrica.key === "faltaComprar";
  const vazio = valor === 0 && (isFalta || mes.tipo === "realizado" ? metrica.key !== "estoqueFinal" && metrica.key !== "estoqueInicial" : false);
  return (
    <td
      className="min-w-[76px] border-b border-[var(--gridline)] px-2 py-1.5 text-right text-xs tabular-nums"
      style={{
        backgroundColor: mes.tipo === "projetado" ? "color-mix(in srgb, var(--series-1) 4%, transparent)" : undefined,
        color: isFalta && valor > 0 ? "var(--status-critical)" : metrica.destaque ? "var(--text-primary)" : "var(--text-secondary)",
        fontWeight: metrica.destaque ? 600 : 400,
      }}
    >
      {vazio ? <span className="text-[var(--text-muted)]">—</span> : valor.toLocaleString("pt-BR")}
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
            <Celula key={mes.mes} valor={mes[metrica.key] as number} mes={mes} metrica={metrica} />
          ))}
        </tr>
      ))}
    </>
  );
}

function GrupoBloco({ grupo, mesesHeader }: { grupo: GrupoLinha; mesesHeader: string[] }) {
  const [aberto, setAberto] = useState(false);
  const faltaTotal = grupo.meses.reduce((s, m) => s + m.faltaComprar, 0);

  return (
    <>
      <tr className="border-t-2 border-[var(--border)]">
        <td className="sticky left-0 z-10 bg-[var(--surface-1)] px-3 py-2" colSpan={1}>
          <button type="button" onClick={() => setAberto((v) => !v)} className="flex items-center gap-1.5 text-left text-sm font-semibold text-[var(--text-primary)]">
            <span className="inline-block w-3 text-[var(--text-muted)] transition-transform" style={{ transform: aberto ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
            {grupo.grupo}
          </button>
        </td>
        {mesesHeader.map((mes, i) => (
          <td key={mes} className="bg-[var(--surface-1)] px-2 py-2">
            {i === 0 && (
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
                <button type="submit" className="rounded-md border border-[var(--border)] px-1 text-[10px] text-[var(--text-muted)] hover:bg-[var(--page-plane)]" title="Salvar">✓</button>
              </form>
            )}
            {i === 1 && faltaTotal > 0 && (
              <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--status-critical) 15%, transparent)", color: "var(--status-critical)" }}>
                falta {faltaTotal.toLocaleString("pt-BR")} no total
              </span>
            )}
          </td>
        ))}
      </tr>
      <BlocoLinhas meses={grupo.meses} />
      {aberto &&
        grupo.produtos.map((produto) => (
          <>
            <tr key={`${produto.produto}-header`}>
              <td className="sticky left-0 z-10 bg-[var(--page-plane)] px-3 py-1.5 pl-6 text-xs font-medium whitespace-nowrap text-[var(--text-primary)]" colSpan={1}>
                {produto.produto}
              </td>
              {mesesHeader.map((mes) => (
                <td key={mes} className="bg-[var(--page-plane)]" />
              ))}
            </tr>
            <BlocoLinhas key={`${produto.produto}-linhas`} meses={produto.meses} indent />
          </>
        ))}
    </>
  );
}

export function MapaComprasGrid({ grupos }: { grupos: GrupoLinha[] }) {
  const mesesHeader = grupos[0]?.meses.map((m) => m.mes) ?? [];

  return (
    <div className="overflow-x-auto overflow-y-visible rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 min-w-[200px] border-b border-[var(--gridline)] bg-[var(--surface-1)] px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]">
              Grupo / Produto
            </th>
            {mesesHeader.map((mes) => {
              const tipo = grupos[0]?.meses.find((m) => m.mes === mes)?.tipo;
              return (
                <th
                  key={mes}
                  className="sticky top-0 z-10 min-w-[76px] border-b border-[var(--gridline)] px-2 py-2 text-right text-xs font-medium whitespace-nowrap text-[var(--text-muted)]"
                  style={{ backgroundColor: tipo === "projetado" ? "color-mix(in srgb, var(--series-1) 8%, var(--surface-1))" : "var(--surface-1)" }}
                >
                  {formatMes(mes)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {grupos.map((grupo) => (
            <GrupoBloco key={grupo.grupo} grupo={grupo} mesesHeader={mesesHeader} />
          ))}
          {grupos.length === 0 && (
            <tr>
              <td colSpan={mesesHeader.length + 1} className="px-4 py-6 text-center text-[var(--text-muted)]">
                Sem dados suficientes ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
