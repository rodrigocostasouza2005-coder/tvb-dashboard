"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { selecionarVendedorAction } from "./actions";

// Etapa de identificação do vendedor dentro do login da loja (sem senha/login próprio — pedido
// do Rodrigo em 2026-09-18). Só aparece pra login restrito a 1 loja (computador físico da loja);
// ADMIN/GESTÃO nunca veem isso — a tela continua exatamente como sempre foi pra eles.
export function VendedorGate({ vendedores, obrigatorio }: { vendedores: string[]; obrigatorio: boolean }) {
  const [nome, setNome] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function continuar() {
    if (!nome) return;
    startTransition(async () => {
      await selecionarVendedorAction(nome);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-sm rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-6 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <h2 className="mb-1 text-sm font-medium text-[var(--text-primary)]">Sugestão de Contato</h2>
      <p className="mb-4 text-sm text-[var(--text-secondary)]">Selecione seu vendedor</p>
      <select
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        className="mb-3 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--series-1)] focus:ring-1 focus:ring-[var(--series-1)]"
        style={{ colorScheme: "light dark" }}
      >
        <option value="">Selecione seu nome</option>
        {vendedores.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={continuar}
        disabled={!nome || isPending}
        className="w-full rounded-md bg-[var(--series-1)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Continuar
      </button>
      {vendedores.length === 0 && (
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          Nenhum vendedor com venda registrada ainda pra essa loja — assim que a primeira venda sincronizar, o nome aparece aqui.
        </p>
      )}
      {!obrigatorio && (
        <p className="mt-3 text-xs text-[var(--text-muted)]">Ou continue sem selecionar pra ver todas as sugestões da loja.</p>
      )}
    </div>
  );
}

// Controle pequeno "Vendedor atual: Pedro ▾" no topo da aba pra trocar sem logout.
export function VendedorAtualSelect({ vendedores, vendedorAtual }: { vendedores: string[]; vendedorAtual: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function trocar(nome: string) {
    startTransition(async () => {
      await selecionarVendedorAction(nome);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="text-xs text-[var(--text-muted)]">Vendedor atual:</label>
      <select
        value={vendedorAtual}
        disabled={isPending}
        onChange={(e) => trocar(e.target.value)}
        className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--series-1)] focus:ring-1 focus:ring-[var(--series-1)]"
        style={{ colorScheme: "light dark" }}
      >
        {vendedores.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    </div>
  );
}
