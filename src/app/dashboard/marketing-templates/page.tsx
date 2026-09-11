import { getSessionUser } from "@/lib/auth";
import { requireTabAccess } from "@/lib/tabs";
import { getMensagemTemplates, TEMPLATE_KEYS } from "@/lib/message-templates";
import { salvarTemplateAction, restaurarPadraoAction } from "./actions";
import { SuccessBanner } from "../admin/success-banner";

export default async function MarketingTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "marketing-templates");
  const { ok } = await searchParams;

  const templates = await getMensagemTemplates();
  const podeEditar = user.role === "ADMIN" || user.role === "GESTAO";

  return (
    <div>
      {ok === "1" && <SuccessBanner message="Template salvo!" />}
      <h1 className="mb-1 text-lg font-semibold">Templates de Mensagem</h1>
      <p className="mb-6 text-sm text-[var(--text-muted)]">
        Texto usado nos links de WhatsApp da aba{" "}
        <a href="/dashboard/clientes-sugestoes-contato" className="underline">Sugestões de Contato</a>, um por segmento.
        {" "}Use <code className="rounded bg-[var(--page-plane)] px-1">{"{nome}"}</code> e os outros placeholders indicados em cada
        card — eles são substituídos pelo dado real do cliente na hora de montar a mensagem.
      </p>

      <div className="flex flex-col gap-4">
        {TEMPLATE_KEYS.map((t) => (
          <div key={t.key} className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium">{t.label}</h2>
              <span className="text-xs text-[var(--text-muted)]">
                Placeholders: {t.placeholders.map((p) => `{${p}}`).join(", ")}
              </span>
            </div>
            {t.extra && <p className="mb-3 text-xs text-[var(--text-muted)]">{t.extra}</p>}

            {podeEditar ? (
              <form action={salvarTemplateAction} className="flex flex-col gap-2">
                <input type="hidden" name="key" value={t.key} />
                <textarea
                  name="texto"
                  defaultValue={templates[t.key]}
                  rows={8}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]"
                  style={{ colorScheme: "light dark" }}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="w-fit rounded-md bg-[var(--series-1)] px-3 py-1.5 text-sm font-medium text-white"
                  >
                    Salvar
                  </button>
                  <button
                    type="submit"
                    formAction={restaurarPadraoAction}
                    className="w-fit rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--page-plane)]"
                  >
                    Restaurar padrão
                  </button>
                </div>
              </form>
            ) : (
              <pre className="whitespace-pre-wrap rounded-md bg-[var(--page-plane)] px-3 py-2 text-sm text-[var(--text-secondary)]">{templates[t.key]}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
