import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { requireTabAccess } from "@/lib/tabs";
import { criarProspectAction, atualizarStatusProspectAction } from "./actions";
import { CsvImportPreview } from "./csv-import-preview";

const STATUS: Record<string, string> = {
  NOVO: "Novo",
  EM_QUALIFICACAO: "Em qualificação",
  QUALIFICADO: "Qualificado",
  CONTATADO: "Contatado",
  NEGOCIACAO: "Em negociação",
  CONVERTIDO: "Convertido",
  DESCARTADO: "Descartado",
};

export default async function AtacadoProspeccaoPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; erro?: string; criado?: string; importacao?: string; novos?: string; duplicados?: string; invalidos?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "atacado-prospeccao");

  const params = await searchParams;
  const status = params.status && Object.hasOwn(STATUS, params.status) ? params.status : undefined;
  const prospects = await prisma.atacadoProspect.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ updatedAt: "desc" }],
    take: 250,
    include: { activities: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const [total, novos, qualificados, contatados] = await Promise.all([
    prisma.atacadoProspect.count(),
    prisma.atacadoProspect.count({ where: { status: "NOVO" } }),
    prisma.atacadoProspect.count({ where: { status: "QUALIFICADO" } }),
    prisma.atacadoProspect.count({ where: { status: "CONTATADO" } }),
  ]);

  const erro = params.erro;
  const erroTexto = erro === "nome" ? "Informe o nome da loja."
    : erro === "cnpj" ? "Informe um CNPJ com 14 caracteres válidos."
    : erro === "estado" ? "Informe a UF com duas letras."
    : erro === "duplicado" ? "Já existe um prospecto cadastrado com esse CNPJ."
    : erro === "status" ? "Status inválido."
    : erro === "nao-encontrado" ? "Prospecto não encontrado."
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Atacado · Expansão comercial</p>
          <h1 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">Prospecção de novos lojistas</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            Cadastre e acompanhe lojas com potencial para revender TVB. Prospectos ficam separados da base de clientes já sincronizada pelo DAPIC.
          </p>
        </div>
        <Link href="/dashboard/atacado" className="text-sm text-[var(--text-secondary)] underline">Voltar para Atacado</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Prospectos", total],
          ["Novos", novos],
          ["Qualificados", qualificados],
          ["Contatados", contatados],
        ].map(([label, count]) => (
          <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
            <div className="text-xs text-[var(--text-muted)]">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{count}</div>
          </div>
        ))}
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <h2 className="mb-3 text-sm font-semibold">Cadastrar prospecto</h2>
        {erroTexto && <p role="alert" className="mb-3 rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-600">{erroTexto}</p>}
        {params.criado && <p className="mb-3 rounded-md border border-green-600/40 px-3 py-2 text-sm text-green-700">Prospecto cadastrado.</p>}
        <form action={criarProspectAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-[var(--text-secondary)]">Nome da loja *
            <input required name="nomeFantasia" maxLength={160} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">Razão social
            <input name="razaoSocial" maxLength={180} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">CNPJ
            <input name="cnpj" inputMode="numeric" maxLength={18} placeholder="00.000.000/0000-00" className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">Cidade
            <input name="cidade" maxLength={100} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">UF
            <input name="estado" maxLength={2} placeholder="RJ" className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm uppercase text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">Telefone comercial
            <input name="telefone" maxLength={40} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">E-mail comercial
            <input name="email" type="email" maxLength={180} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">Site / Instagram
            <input name="site" maxLength={500} placeholder="https://" className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">Link da evidência / origem
            <input name="evidenciaUrl" type="url" maxLength={1000} placeholder="https://" className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">Origem
            <select name="origem" className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]">
              <option value="manual">Cadastro manual</option>
              <option value="indicacao">Indicação</option>
              <option value="pesquisa_web">Pesquisa na web</option>
              <option value="feira_evento">Feira / evento</option>
              <option value="importacao">Importação</option>
            </select>
          </label>
          <label className="text-xs text-[var(--text-secondary)] sm:col-span-2 lg:col-span-3">Observações
            <textarea name="observacoes" rows={2} maxLength={3000} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <div className="sm:col-span-2 lg:col-span-3">
            <button type="submit" className="rounded-md bg-[var(--series-1)] px-4 py-2 text-sm font-medium text-white">Salvar prospecto</button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Importar lista de lojas (CSV)</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Até 500 linhas e 900 KB. Colunas aceitas: nome_fantasia (obrigatória), razao_social, cnpj, cidade, uf, telefone, email, site e evidencia_url.</p>
          </div>
          <a href="/exemplos/modelo-prospeccao-atacado.csv" className="text-xs underline text-[var(--text-secondary)]">Baixar modelo CSV</a>
        </div>
        {params.importacao === "concluida" && <p role="status" className="mt-3 text-sm text-[var(--text-secondary)]">Importação concluída: {params.novos ?? "0"} novos, {params.duplicados ?? "0"} duplicados ignorados e {params.invalidos ?? "0"} linhas inválidas.</p>}
        {params.importacao && params.importacao !== "concluida" && <p role="alert" className="mt-3 text-sm text-red-600">Não foi possível importar. Verifique o arquivo, o cabeçalho e o limite de tamanho/linhas.</p>}
        <CsvImportPreview />
      </section>
      <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-semibold">Carteira de prospectos ({prospects.length}{total > 250 ? " de " + total : ""})</h2>
          <form className="flex items-center gap-2" action="/dashboard/atacado-prospeccao">
            <label htmlFor="status" className="text-xs text-[var(--text-muted)]">Status</label>
            <select id="status" name="status" defaultValue={status ?? ""} className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              {Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <button className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs">Filtrar</button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Loja</th>
                <th className="px-4 py-3 font-medium">Localização</th>
                <th className="px-4 py-3 font-medium">Contato</th>
                <th className="px-4 py-3 font-medium">Origem</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((p) => (
                <tr key={p.id} className="border-t border-[var(--border)] align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.nomeFantasia}</div>
                    {p.cnpj && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{p.cnpj}</div>}
                    {p.evidenciaUrl && <a href={p.evidenciaUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs underline text-[var(--text-secondary)]">Ver evidência</a>}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{[p.cidade, p.estado].filter(Boolean).join(" / ") || "—"}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{p.telefone || p.email || "—"}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{p.origem.replaceAll("_", " ")}</td>
                  <td className="px-4 py-3">
                    <form action={atualizarStatusProspectAction} className="flex min-w-44 items-center gap-1">
                      <input type="hidden" name="prospectId" value={p.id} />
                      <select name="status" defaultValue={p.status} aria-label="Status do prospecto" className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs">
                        {Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select>
                      <button type="submit" className="rounded-md border border-[var(--border)] px-2 py-1 text-xs">Salvar</button>
                    </form>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--text-muted)]">{p.updatedAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                </tr>
              ))}
              {prospects.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">Nenhum prospecto cadastrado. Comece adicionando uma loja ou importe uma base numa próxima etapa.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
