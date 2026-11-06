"use client";

import { useActionState } from "react";
import {
  ativarBannerBlackFridayAction,
  desativarBannerBlackFridayAction,
  voltarAutomaticoBannerAction,
} from "./actions";

type State = { ok: boolean; message: string; label: string };

// Formato fixo "dd/mm/aaaa HH:mm" em horário de Brasília, pros dois extremos da janela — exibição
// só-leitura (as datas são fixas no código, não editáveis aqui, pedido explícito do Rodrigo em
// 2026-11-05).
const INICIO_LABEL = "10/11/2026 06:00 (Brasília)";
const FIM_LABEL = "01/12/2026 06:00 (Brasília)";

export function BlackFridayBannerSection({ initialLabel }: { initialLabel: string }) {
  const [state, dispatch, isPending] = useActionState<State, "ATIVO" | "INATIVO" | "AUTO">(
    async (_prev, acao) => {
      if (acao === "ATIVO") return ativarBannerBlackFridayAction();
      if (acao === "INATIVO") return desativarBannerBlackFridayAction();
      return voltarAutomaticoBannerAction();
    },
    { ok: true, message: "", label: initialLabel }
  );

  const label = state.label;
  const forcado = label.startsWith("Forçado");

  return (
    <section className="mb-8 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
      <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Campanha Black Friday</h2>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Faixa vermelha animada no topo de todas as páginas do dashboard. Liga/desliga sozinha na
        janela abaixo (horário de Brasília, fixo — não editável aqui); os botões servem só pra
        forçar um estado diferente temporariamente.
      </p>

      <div className="mb-3 flex flex-col gap-1 rounded-md border border-[var(--border)] bg-[var(--page-plane)] p-3 text-xs text-[var(--text-secondary)]">
        <div>
          <strong>Início automático:</strong> {INICIO_LABEL}
        </div>
        <div>
          <strong>Fim automático:</strong> {FIM_LABEL}
        </div>
      </div>

      <p className="mb-3 text-xs">
        <strong>Status atual: </strong>
        <span style={{ color: forcado ? "var(--status-warning)" : "var(--text-secondary)" }}>{label}</span>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <form action={() => dispatch("ATIVO")}>
          <button
            type="submit"
            disabled={isPending}
            className="w-fit rounded-md bg-[var(--series-1)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {isPending ? "..." : "Ativar agora"}
          </button>
        </form>
        <form action={() => dispatch("INATIVO")}>
          <button
            type="submit"
            disabled={isPending}
            className="w-fit rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)] disabled:opacity-50"
          >
            {isPending ? "..." : "Desativar"}
          </button>
        </form>
        {forcado && (
          <form action={() => dispatch("AUTO")}>
            <button
              type="submit"
              disabled={isPending}
              className="w-fit rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--page-plane)] disabled:opacity-50"
            >
              {isPending ? "..." : "Voltar ao automático"}
            </button>
          </form>
        )}
      </div>

      {state.message && !state.ok && (
        <p className="mt-2 text-xs" style={{ color: "var(--status-critical)" }}>
          {state.message}
        </p>
      )}
    </section>
  );
}
