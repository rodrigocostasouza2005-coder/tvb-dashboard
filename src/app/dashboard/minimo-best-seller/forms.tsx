"use client";

import { useState } from "react";
import { atualizarEstoqueMinimoEmpresarialAction } from "../mapa-compras/classificacao-actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-1.5 py-1 text-[11px] text-[var(--text-primary)]";
const btnClass =
  "rounded-md border border-[var(--border)] px-1.5 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--page-plane)]";

// Edição inline do mínimo empresarial (pedido do Rodrigo: ajustar direto no elemento, efeito
// imediato, não um formulário à parte — ver feedback_inline_controls). A sugestão ao lado é só
// texto informativo (cálculo 100% client-side, nunca grava nada) — "N dias" é um input livre do
// próprio usuário, default 30, pra ele simular antes de decidir o valor real a salvar no campo
// editável de verdade. Mesmo padrão visual de ParametrosGrupoForm (mapa-compras/inteligencia/forms.tsx).
export function MinimoEmpresarialForm({
  cod,
  minimoDefinido,
  velocidadeDiariaConsolidada,
}: {
  cod: string;
  minimoDefinido: number | null;
  velocidadeDiariaConsolidada: number;
}) {
  const [dias, setDias] = useState(30);
  const sugestao = Math.round(velocidadeDiariaConsolidada * dias);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={atualizarEstoqueMinimoEmpresarialAction} className="flex items-center gap-1.5">
        <input type="hidden" name="cod" value={cod} />
        <input
          type="number"
          name="estoqueMinimoEmpresarial"
          defaultValue={minimoDefinido ?? ""}
          min={0}
          placeholder="sem mínimo"
          className={`${inputClass} w-20 text-right tabular-nums`}
        />
        <button type="submit" className={btnClass} title="Salvar mínimo empresarial deste tamanho">
          Salvar
        </button>
      </form>

      <span className="text-[11px] text-[var(--text-muted)]">
        sugestão: {sugestao.toLocaleString("pt-BR")} un. (venda média ×{" "}
        <input
          type="number"
          value={dias}
          min={1}
          onChange={(e) => setDias(Math.max(1, Number(e.target.value) || 1))}
          className="w-10 rounded border border-[var(--border)] bg-[var(--surface-1)] px-1 text-right text-[11px] tabular-nums text-[var(--text-primary)]"
        />{" "}
        dias — nunca gravado automaticamente)
      </span>
    </div>
  );
}
