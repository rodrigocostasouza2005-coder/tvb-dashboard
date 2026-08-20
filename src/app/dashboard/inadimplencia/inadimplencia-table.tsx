"use client";

import { useMemo, useState } from "react";
import type { ParcelaVencida } from "@/lib/inadimplencia";

const LIMIT = 200;

function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("pt-BR");
}

function AtrasobAdge({ dias }: { dias: number }) {
  let bg: string;
  let color: string;

  if (dias <= 30) {
    bg = "#fef3c7";
    color = "#92400e";
  } else if (dias <= 60) {
    bg = "#ffedd5";
    color = "#9a3412";
  } else {
    bg = "#fee2e2";
    color = "#991b1b";
  }

  return (
    <span
      style={{ backgroundColor: bg, color }}
      className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
    >
      {dias}d
    </span>
  );
}

const selectClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs text-[var(--text-primary)]";

export function InadimplenciaTable({ parcelas }: { parcelas: ParcelaVencida[] }) {
  const [search, setSearch] = useState("");
  // Padrão: 4.1.4 = clientes atacado B2B (Inter). "todas" mostra tudo.
  const [planoFiltro, setPlanoFiltro] = useState("4.1.4");
  const [formaPgtoFiltro, setFormaPgtoFiltro] = useState("");

  const formasPgto = useMemo(
    () => [...new Set(parcelas.map((p) => p.formaPagamento))].sort(),
    [parcelas]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parcelas.filter((p) => {
      if (planoFiltro !== "" && p.planoConta !== planoFiltro) return false;
      if (formaPgtoFiltro !== "" && p.formaPagamento !== formaPgtoFiltro) return false;
      if (q === "") return true;
      return p.pessoa.toLowerCase().includes(q) || p.conta.toLowerCase().includes(q);
    });
  }, [parcelas, search, planoFiltro, formaPgtoFiltro]);

  const visible = filtered.slice(0, LIMIT);

  return (
    <div>
      {/* Filters row */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente ou conta..."
          className="w-full max-w-xs rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
        <select
          className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
          value={planoFiltro}
          onChange={(e) => setPlanoFiltro(e.target.value)}
        >
          <option value="4.1.4">Atacado (Inter)</option>
          <option value="4.1.3">Site varejo</option>
          <option value="">Todos</option>
        </select>
        <select
          className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
          value={formaPgtoFiltro}
          onChange={(e) => setFormaPgtoFiltro(e.target.value)}
        >
          <option value="">Todas as formas de pgto</option>
          {formasPgto.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="border-b border-[var(--gridline)] text-left text-[var(--text-muted)]">
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Conta</th>
              <th className="px-4 py-2 font-medium text-right">Nº Parcela</th>
              <th className="px-4 py-2 font-medium">Forma Pgto</th>
              <th className="px-4 py-2 font-medium">Vencimento</th>
              <th className="px-4 py-2 font-medium text-right">Dias em atraso</th>
              <th className="px-4 py-2 font-medium text-right">Valor total</th>
              <th className="px-4 py-2 font-medium text-right">Valor pago</th>
              <th className="px-4 py-2 font-medium text-right">Valor em aberto</th>
              <th className="px-4 py-2 font-medium text-right">Multa+Juros</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr
                key={p.idParcela}
                className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]"
              >
                <td className="px-4 py-2 font-medium text-[var(--text-primary)]">
                  {p.pessoa}
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">{p.conta}</td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                  {p.numeroParcela}
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">
                  {p.formaPagamento}
                </td>
                <td className="px-4 py-2 text-[var(--text-secondary)]">
                  {formatDate(p.dataVencimento)}
                </td>
                <td className="px-4 py-2 text-right">
                  <AtrasobAdge dias={p.diasAtraso} />
                </td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                  {formatBRL(p.valor)}
                </td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                  {formatBRL(p.valorPago)}
                </td>
                <td className="px-4 py-2 tabular-nums text-right font-medium text-[var(--text-primary)]">
                  {formatBRL(p.valorAberto)}
                </td>
                <td className="px-4 py-2 tabular-nums text-right text-[var(--text-secondary)]">
                  {formatBRL(p.valorMulta + p.valorJuros)}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-6 text-center text-[var(--text-muted)]"
                >
                  Nenhuma parcela vencida encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Mostrando {visible.length} de {filtered.length} parcelas
      </p>
    </div>
  );
}
