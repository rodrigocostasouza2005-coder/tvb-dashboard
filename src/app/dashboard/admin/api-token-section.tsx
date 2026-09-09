"use client";

import { useActionState, useState } from "react";
import { generateApiTokenAction, revealApiTokenAction } from "./actions";

type State = { ok: boolean; message: string; token?: string };

const initialState: State = { ok: true, message: "" };
const BASE_URL = "https://tvb-dashboard.vercel.app";

export function ApiTokenSection({ hasToken, updatedAtLabel }: { hasToken: boolean; updatedAtLabel: string | null }) {
  const [genState, generateAction, generating] = useActionState<State, FormData>(
    async () => generateApiTokenAction(),
    initialState
  );
  const [revealState, revealActionForm, revealing] = useActionState<State, FormData>(
    async () => revealApiTokenAction(),
    initialState
  );
  const [copied, setCopied] = useState<"token" | "mcp" | null>(null);

  // O token mais recente que apareceu na tela, seja de gerar ou de revelar — os dois formulários
  // mostram o mesmo bloco de resultado embaixo.
  const token = genState.token ?? revealState.token;

  function copy(text: string, which: "token" | "mcp") {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <section className="mb-8 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
      <h2 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Integração com ChatGPT / Claude</h2>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Conecta o Radar num Custom GPT (ChatGPT Actions) ou num Conector MCP (Claude) — dá pra
        perguntar sobre vendas, estoque e grade de tamanho direto na conversa. O token abaixo dá
        acesso a TUDO (sem a separação por loja/financeiro do login normal) — não compartilhe.
      </p>

      <p className="mb-3 text-xs text-[var(--text-secondary)]">
        {hasToken ? `Token ativo, gerado em ${updatedAtLabel}.` : "Nenhum token gerado ainda."}
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {hasToken && (
          <form action={revealActionForm}>
            <button
              type="submit"
              disabled={revealing}
              className="w-fit rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)] disabled:opacity-50"
            >
              {revealing ? "Buscando..." : "Ver token"}
            </button>
          </form>
        )}
        <form action={generateAction}>
          <button
            type="submit"
            disabled={generating}
            className="w-fit rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--page-plane)] disabled:opacity-50"
          >
            {generating ? "Gerando..." : hasToken ? "Gerar novo token (substitui o atual)" : "Gerar token"}
          </button>
        </form>
      </div>

      {token && (
        <div className="mb-3 rounded-md border border-[var(--series-1)] bg-[var(--page-plane)] p-3">
          {genState.token && (
            <p className="mb-2 text-xs font-medium" style={{ color: "var(--status-critical)" }}>
              Token trocado — qualquer GPT/Claude já conectado com o token antigo vai parar de
              funcionar até você atualizar a configuração lá.
            </p>
          )}
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs">
              {token}
            </code>
            <button
              type="button"
              onClick={() => copy(token, "token")}
              className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--surface-1)]"
            >
              {copied === "token" ? "Copiado!" : "Copiar"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 text-xs text-[var(--text-secondary)]">
        <div>
          <strong>ChatGPT (Custom GPT → Ações → Importar de URL):</strong>{" "}
          <code className="rounded bg-[var(--page-plane)] px-1 py-0.5">{BASE_URL}/api/gpt/openapi</code>
          {" — em Autenticação, escolha API Key → Bearer e cole o token acima."}
        </div>
        <div className="flex items-center gap-2">
          <span>
            <strong>Claude (Configurações → Conectores → Adicionar conector personalizado):</strong>{" "}
            {token ? (
              <code className="rounded bg-[var(--page-plane)] px-1 py-0.5">
                {BASE_URL}/api/mcp/{token}
              </code>
            ) : (
              <span className="text-[var(--text-muted)]">clique em "Ver token" ou "Gerar token" acima pra ver o link completo</span>
            )}
          </span>
          {token && (
            <button
              type="button"
              onClick={() => copy(`${BASE_URL}/api/mcp/${token}`, "mcp")}
              className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--page-plane)]"
            >
              {copied === "mcp" ? "Copiado!" : "Copiar"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
