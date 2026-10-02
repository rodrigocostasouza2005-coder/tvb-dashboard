"use client";

import { useState, useTransition } from "react";
import { marcarContatadoAction } from "./actions";
import { formatTelefoneDisplay, telefoneParaTel } from "@/lib/phone";
import { waHref, waAppHref } from "@/lib/whatsapp";
import { usePhoneMode } from "../phone-mode";

function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0];
}

// Diferente de ContatoWhatsappLink (Sugestões — marca e mostra ✓, linha nunca sai da tela): aqui
// clicar marca como tratado E remove a linha da lista de pendências na hora (pedido do Rodrigo em
// 2026-10-02 — "follow-up" é uma fila de trabalho, não um histórico pra revisar depois). Remoção é
// otimista (desaparece no clique, sem esperar o servidor), mas a gravação em ContatoMarcado (ver
// marcarContatadoAction) é obrigatória — se falhar, a linha volta e mostra um aviso, em vez de
// ficar escondida sem o banco saber. revalidatePath (dentro da action) já faz o Next re-buscar a
// lista real do servidor sozinho, sem precisar de router.refresh() aqui (seria consulta duplicada),
// sem navegação/URL nova, então sem salto de scroll. Idempotente pela chave natural de
// ContatoMarcado (tipo+cliente+chave) — clicar 2x rápido só reafirma o mesmo registro, não duplica.
export function FollowUpTableRow({
  cliente,
  clienteHref,
  vendedorOriginal,
  telefone,
  mensagem,
  chave,
  produtos,
  numeroNota,
  diasAtras,
}: {
  cliente: string;
  clienteHref: string;
  vendedorOriginal: string | null;
  telefone: string | null;
  mensagem: string;
  chave: string;
  produtos: string;
  numeroNota: string | null;
  diasAtras: number;
}) {
  const [estado, setEstado] = useState<"visivel" | "removida" | "erro">("visivel");
  const [, startTransition] = useTransition();
  const { mode } = usePhoneMode();
  const [copiado, setCopiado] = useState(false);

  function handleClick() {
    setEstado("removida");
    startTransition(async () => {
      try {
        await marcarContatadoAction("followup", cliente, chave);
      } catch {
        setEstado("erro");
      }
    });
  }

  if (estado === "removida") return null;
  // Sem telefone não dá pra chamar no WhatsApp — getFollowUpPosCompra já filtra isso fora na
  // prática (nunca chega aqui sem telefone), mantido só como defesa (mesmo padrão de antes).

  return (
    <tr className="border-b border-[var(--gridline)] last:border-0 hover:bg-[var(--page-plane)]">
      <td className="px-4 py-2 font-medium">
        <a href={clienteHref} className="hover:underline">{cliente}</a>
        {vendedorOriginal && (
          <div className="text-xs font-normal text-[var(--text-muted)]">
            Ex-cliente de {primeiroNome(vendedorOriginal)}
          </div>
        )}
      </td>
      <td className="px-4 py-2">
        {telefone ? (
          <span className="inline-flex items-center gap-1.5">
            <a
              href={mode === "mobile" ? waAppHref(telefone, mensagem) : waHref(telefone, mensagem)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleClick}
              className={`text-[var(--series-1)] hover:underline tabular-nums ${mode === "mobile" ? "text-base py-1" : ""}`}
            >
              {formatTelefoneDisplay(telefone)}
            </a>
            {mode === "mobile" ? (
              <a
                href={`tel:+${telefoneParaTel(telefone)}`}
                title="Ligar"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm hover:bg-[var(--page-plane)]"
              >
                📞
              </a>
            ) : (
              <button
                type="button"
                title="Copiar número"
                onClick={() => {
                  navigator.clipboard.writeText(formatTelefoneDisplay(telefone)).then(() => {
                    setCopiado(true);
                    setTimeout(() => setCopiado(false), 1500);
                  });
                }}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm hover:bg-[var(--page-plane)]"
              >
                {copiado ? "✅" : "📋"}
              </button>
            )}
            {estado === "erro" && (
              <span
                title="Não deu pra marcar como tratado — clique de novo"
                className="text-xs"
                style={{ color: "var(--status-critical)" }}
              >
                ⚠️
              </span>
            )}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        )}
      </td>
      <td className="px-4 py-2 text-[var(--text-secondary)]">{produtos}</td>
      <td className="px-4 py-2 tabular-nums text-[var(--text-secondary)]">
        {numeroNota ?? <span className="text-[var(--text-muted)]">—</span>}
      </td>
      <td className="px-4 py-2 tabular-nums">{diasAtras}</td>
    </tr>
  );
}
