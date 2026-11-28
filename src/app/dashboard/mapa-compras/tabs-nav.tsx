"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

// Troca entre Visão Analítica / Planejamento Mensal preservando TODOS os outros searchParams
// (filtros compartilhados, seção 19 do briefing) — mesmo mecanismo de GetForm (router.push +
// startTransition, scroll:false) pra não voltar a página pro topo nem piscar o loading.tsx
// genérico (ver comentário detalhado em get-form.tsx).
const ABAS = [
  { key: "analitica", label: "Visão Analítica" },
  { key: "planejamento", label: "Planejamento Mensal" },
] as const;

export function TabsNav({ basePath, abaAtiva }: { basePath: string; abaAtiva: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function irPara(aba: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("aba", aba);
    startTransition(() => {
      router.push(`${basePath}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div
      className="mb-4 flex gap-1 border-b border-[var(--border)]"
      style={{ opacity: isPending ? 0.6 : 1, transition: "opacity 0.15s ease" }}
    >
      {ABAS.map((aba) => {
        const ativa = aba.key === abaAtiva;
        return (
          <button
            key={aba.key}
            type="button"
            onClick={() => irPara(aba.key)}
            className="border-b-2 px-3 py-2 text-sm transition-colors"
            style={{
              borderColor: ativa ? "var(--series-1)" : "transparent",
              color: ativa ? "var(--text-primary)" : "var(--text-secondary)",
              fontWeight: ativa ? 600 : 400,
            }}
          >
            {aba.label}
          </button>
        );
      })}
    </div>
  );
}
