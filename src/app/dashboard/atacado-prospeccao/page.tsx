import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { requireTabAccess } from "@/lib/tabs";
import { criarProspectAction, atualizarStatusProspectAction, registrarInteracaoBruceAction } from "./actions";
import { CsvImportPreview } from "./csv-import-preview";
import { ProspeccaoRadarConsole } from "./prospeccao-radar-console";
import { aprenderPerfis } from "@/lib/prospeccao/aprendizado-comercial";

function classificarAderencia(observacoes: string | null) {
  const texto = observacoes ?? "";
  if (texto.includes("Correspondência CNAE: atividade secundária") || texto.includes("Atividade secundária de varejo de moda/acessórios")) {
    return { label: "Revisar", detalhe: "Moda aparece como atividade secundária", nivel: "revisar" as const };
  }
  if (texto.includes("CNAE principal: 4781400")) {
    return { label: "CNAE de vestuário", detalhe: "Atividade cadastral compatível; validar loja multimarcas e moda masculina", nivel: "medio" as const };
  }
  if (texto.includes("CNAE principal: 4782201") || texto.includes("CNAE principal: 4782202")) {
    return { label: "Complementar", detalhe: "Calçados ou artigos de viagem como atividade principal", nivel: "medio" as const };
  }
  if (texto.includes("CNAE principal: 4789001")) {
    return { label: "Baixa aderência", detalhe: "Bijuterias e suvenires como atividade principal", nivel: "baixo" as const };
  }
  return { label: "Não classificado", detalhe: "Cadastro manual ou sem CNAE disponível", nivel: "neutro" as const };
}

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
  searchParams: Promise<{ status?: string; grupo?: string; cidade?: string; uf?: string; erro?: string; criado?: string; importacao?: string; novos?: string; duplicados?: string; invalidos?: string; bruce?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "atacado-prospeccao");

  const params = await searchParams;
  const status = params.status && Object.hasOwn(STATUS, params.status) ? params.status : undefined;
  const grupos = ["A", "B", "C", "D", "PENDENTE"];
  const grupo = params.grupo && grupos.includes(params.grupo) ? params.grupo : undefined;
  const uf = params.uf && /^[A-Z]{2}$/.test(params.uf.toUpperCase()) ? params.uf.toUpperCase() : undefined;
  const cidade = params.cidade?.trim().slice(0, 100) || undefined;
  const where = {
    ...(status ? { status } : {}),
    ...(grupo ? { grupoComercial: grupo } : {}),
    ...(uf ? { estado: uf } : {}),
    ...(cidade ? { cidade: { contains: cidade, mode: "insensitive" as const } } : {}),
  };
  const prospects = await prisma.atacadoProspect.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: 250,
    include: { activities: { orderBy: { createdAt: "desc" }, take: 3 } },
  });

  const [total, novos, emPesquisa, qualificados, contatados, grupoA, grupoB, grupoC, grupoD, cidades] = await Promise.all([
    prisma.atacadoProspect.count(),
    prisma.atacadoProspect.count({ where: { status: "NOVO" } }),
    prisma.atacadoProspect.count({ where: { status: "EM_QUALIFICACAO" } }),
    prisma.atacadoProspect.count({ where: { status: "QUALIFICADO" } }),
    prisma.atacadoProspect.count({ where: { status: "CONTATADO" } }),
    prisma.atacadoProspect.count({ where: { grupoComercial: "A" } }),
    prisma.atacadoProspect.count({ where: { grupoComercial: "B" } }),
    prisma.atacadoProspect.count({ where: { grupoComercial: "C" } }),
    prisma.atacadoProspect.count({ where: { grupoComercial: "D" } }),
    prisma.atacadoProspect.findMany({ where: { estado: uf ?? "RJ" }, distinct: ["cidade"], select: { cidade: true }, orderBy: { cidade: "asc" }, take: 300 }),
  ]);

  const atividadesAprendizado = await prisma.atacadoProspectActivity.findMany({
    where: { tipo: "INTERACAO_BRUCE", resultado: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: {
      prospectId: true,
      resultado: true,
      prospect: { select: { segmentoComercial: true, perfilLoja: true, faixaPreco: true, estado: true, status: true } },
    },
  });
  const recomendacoesBruce = aprenderPerfis(atividadesAprendizado.map((atividade) => ({
    prospectId: atividade.prospectId,
    resultado: atividade.resultado as "INTERESSADO" | "SEM_RESPOSTA" | "RECUSOU" | "PEDIU_CATALOGO" | "PEDIU_PRECO" | "NEGOCIANDO" | "PEDIDO_REALIZADO" | "RECOMPRA" | "SEM_ADERENCIA" | "DADOS_INVALIDOS" | "OUTRO" | null,
    segmentoComercial: atividade.prospect.segmentoComercial,
    perfilLoja: atividade.prospect.perfilLoja,
    faixaPreco: atividade.prospect.faixaPreco,
    estado: atividade.prospect.estado,
    status: atividade.prospect.status,
  })));

  const erro = params.erro;
  const erroTexto = erro === "nome" ? "Informe o nome da loja."
    : erro === "cnpj" ? "Informe um CNPJ com 14 caracteres válidos."
    : erro === "estado" ? "Informe a UF com duas letras."
    : erro === "url" ? "Use apenas endereços completos iniciados por http:// ou https://."
    : erro === "duplicado" ? "Já existe um prospecto cadastrado com esse CNPJ."
    : erro === "conversao" ? "Conversão só é confirmada após o primeiro pedido aparecer no DAPIC."
    : erro === "status" ? "Status inválido."
    : erro === "nao-encontrado" ? "Prospecto não encontrado."
    : null;

  return (
    <div className="space-y-6">
      {params.bruce === "registrado" && <p role="status" className="rounded-md border border-green-600/40 px-3 py-2 text-sm text-green-700">Interação registrada no histórico do Radar.</p>}
      {params.bruce === "erro" && <p role="alert" className="rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-600">Não foi possível registrar a interação. Confira os campos e tente novamente.</p>}
      <ProspeccaoRadarConsole total={total} novos={novos} emPesquisa={emPesquisa} qualificados={qualificados} contatados={contatados} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {([["A", grupoA], ["B", grupoB], ["C", grupoC], ["D", grupoD], ["Pendentes", total - grupoA - grupoB - grupoC - grupoD]] as const).map(([label, count]) => (
          <Link key={label} href={label === "Pendentes" ? "?grupo=PENDENTE" : `?grupo=${label}`} className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 hover:border-[var(--series-1)]">
            <div className="text-xs text-[var(--text-muted)]">Grupo {label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{count.toLocaleString("pt-BR")}</div>
          </Link>
        ))}
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Bruce · Inteligência comercial</h2>
            <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">Bruce acompanha a carteira. O Radar considera a interação mais recente de cada loja, exige ao menos cinco lojas e três resultados conclusivos por perfil, e separa interesse comercial de conversão confirmada no DAPIC.</p>
          </div>
          <span className="text-xs text-[var(--text-muted)]">{recomendacoesBruce.length} padrões com amostra mínima</span>
        </div>
        {recomendacoesBruce.length > 0 ? (
          <div className="mt-3 divide-y divide-[var(--border)]">
            {recomendacoesBruce.map((item) => <div key={item.perfil} className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs">
              <div className="font-medium">{item.perfil}</div>
              <div className="flex gap-3 text-[var(--text-secondary)]">
                <span>{item.totalLojas} lojas</span>
                <span>{item.sinaisPositivos}/{item.interacoesComSinal} sinais positivos</span>
                <span>{item.convertidasDapic} pedidos DAPIC</span>
                <span>{item.taxaConversaoDapic}% conversão DAPIC</span>
                <span>confiança {item.confianca.toLowerCase()}</span>
              </div>
            </div>)}
          </div>
        ) : (
          <p className="mt-3 rounded-md border border-dashed border-[var(--border)] px-3 py-3 text-xs text-[var(--text-muted)]">Ainda não há amostra suficiente. O Radar só exibirá um padrão quando houver pelo menos cinco lojas distintas no perfil e três resultados de interação que indiquem avanço ou recusa. “Pedido realizado” anotado pelo Bruce não conta como conversão: essa confirmação depende do DAPIC.</p>
        )}
      </section>

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
          <form className="flex flex-wrap items-center gap-2" action="/dashboard/atacado-prospeccao">
            <label htmlFor="uf" className="text-xs text-[var(--text-muted)]">UF</label>
            <input id="uf" name="uf" defaultValue={uf ?? ""} placeholder="RJ" maxLength={2} className="w-14 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm" />
            <label htmlFor="cidade" className="text-xs text-[var(--text-muted)]">Cidade</label>
            <input id="cidade" name="cidade" list="cidades-prospects" defaultValue={cidade ?? ""} placeholder="Rio de Janeiro" className="w-40 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm" />
            <datalist id="cidades-prospects">{cidades.map((item) => item.cidade && <option key={item.cidade} value={item.cidade} />)}</datalist>
            <label htmlFor="grupo" className="text-xs text-[var(--text-muted)]">Grupo</label>
            <select id="grupo" name="grupo" defaultValue={grupo ?? ""} className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              {grupos.map((item) => <option key={item} value={item}>{item === "PENDENTE" ? "Pendente" : `Grupo ${item}`}</option>)}
            </select>
            <label htmlFor="status" className="text-xs text-[var(--text-muted)]">Status</label>
            <select id="status" name="status" defaultValue={status ?? ""} className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              {Object.entries(STATUS).map(([key, label]) => <option key={key} value={key} disabled={key === "CONVERTIDO"}>{key === "CONVERTIDO" ? "Convertido (confirmação DAPIC)" : label}</option>)}
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
                <th className="px-4 py-3 font-medium">Aderência</th>
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
                    <div className="font-medium">{p.nomeFantasia === "NOME COMERCIAL NÃO IDENTIFICADO" ? "Nome comercial a pesquisar" : p.nomeFantasia}</div>
                    {p.razaoSocial && <div className="mt-0.5 text-xs text-[var(--text-muted)]">Razão social: {p.razaoSocial}</div>}
                    {p.instagram && <a href={p.instagram} target="_blank" rel="noreferrer" className="mt-1 block text-xs underline">Instagram</a>}
                    {p.site && <a href={p.site} target="_blank" rel="noreferrer" className="mt-1 block text-xs underline">Site</a>}
                    {p.cnpj && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{p.cnpj}</div>}
                    {p.evidenciaUrl && <a href={p.evidenciaUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs underline text-[var(--text-secondary)]">Ver evidência</a>}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{[p.cidade, p.estado].filter(Boolean).join(" / ") || "Cidade não identificada"}</td>
                  <td className="px-4 py-3">
                    <div className="mb-1 font-semibold">{p.grupoComercial === "PENDENTE" ? "Pendente" : `Grupo ${p.grupoComercial}`}</div>
                    {p.scoreComercial !== null && <div className="text-[11px] text-[var(--text-muted)]">Score cadastral {p.scoreComercial}/100</div>}
                    {p.justificativaGrupo && <div className="mt-1 max-w-48 text-[11px] text-[var(--text-muted)]">{p.justificativaGrupo}</div>}
                    {p.responsavel && <div className="mt-1 text-[11px] font-medium text-[var(--series-1)]">Fila: {p.responsavel.replaceAll("_", " ")}</div>}
                    {p.confiancaPesquisa === "CADASTRAL" && <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">Fonte cadastral oficial; perfil comercial ainda não verificado</div>}
                    {(() => {
                      const fit = classificarAderencia(p.observacoes);
                      return <div title={fit.detalhe} className="text-xs">
                        <span className={fit.nivel === "revisar" ? "font-semibold text-amber-700" : "text-[var(--text-secondary)]"}>{fit.label}</span>
                        <div className="mt-0.5 max-w-48 text-[11px] text-[var(--text-muted)]">{fit.detalhe}</div>
                      </div>;
                    })()}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                    {p.telefone && <div>{p.telefone}</div>}
                    {p.email && <div className="mt-1 break-all">{p.email}</div>}
                    {!p.telefone && !p.email && "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{p.origem.replaceAll("_", " ")}</td>
                  <td className="px-4 py-3">
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-[var(--text-secondary)] underline">Histórico recente ({p.activities.length})</summary>
                      <div className="mt-2 space-y-2">
                        {p.activities.map((activity) => <div key={activity.id} className="rounded border border-[var(--border)] p-2 text-[11px]">
                          <div className="font-medium">{activity.tipo.replaceAll("_", " ")}{activity.resultado ? ` · ${activity.resultado.replaceAll("_", " ")}` : ""}</div>
                          <div className="mt-0.5 text-[var(--text-secondary)]">{activity.descricao}</div>
                          <div className="mt-0.5 text-[var(--text-muted)]">{activity.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</div>
                        </div>)}
                      </div>
                    </details>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] font-medium text-[var(--series-1)] underline">Bruce · Registrar interação</summary>
                      <form action={registrarInteracaoBruceAction} className="mt-2 min-w-48 space-y-2">
                        <input type="hidden" name="prospectId" value={p.id} />
                        <textarea name="descricao" required maxLength={1200} rows={2} placeholder="O que aconteceu na conversa?" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs" />
                        <select name="resultado" defaultValue="" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs">
                          <option value="">Resultado (opcional)</option>
                          {["INTERESSADO","SEM_RESPOSTA","RECUSOU","PEDIU_CATALOGO","PEDIU_PRECO","NEGOCIANDO","PEDIDO_REALIZADO","RECOMPRA","SEM_ADERENCIA","DADOS_INVALIDOS","OUTRO"].map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
                        </select>
                        <select name="canal" defaultValue="" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs">
                          <option value="">Canal (opcional)</option>
                          {["TELEFONE","EMAIL","INSTAGRAM","WHATSAPP","PRESENCIAL","OUTRO"].map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                        <input name="etapa" maxLength={80} placeholder="Etapa (opcional)" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs" />
                        <select name="status" defaultValue="" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs">
                          <option value="">Manter status atual</option>
                          {Object.entries(STATUS).filter(([key]) => key !== "CONVERTIDO").map(([key,label]) => <option key={key} value={key}>{label}</option>)}
                        </select>
                        <button type="submit" className="w-full rounded-md border border-[var(--series-1)] px-2 py-1.5 text-xs font-medium">Salvar no Radar</button>
                      </form>
                    </details>
                    <form action={atualizarStatusProspectAction} className="mt-2 flex min-w-44 items-center gap-1">
                      <input type="hidden" name="prospectId" value={p.id} />
                      <select name="status" defaultValue={p.status} aria-label="Status do prospecto" className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs">
                        {Object.entries(STATUS).filter(([key]) => key !== "CONVERTIDO").map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select>
                      <button type="submit" className="rounded-md border border-[var(--border)] px-2 py-1 text-xs">Salvar</button>
                    </form>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--text-muted)]">{p.updatedAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                </tr>
              ))}
              {prospects.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">Nenhum prospecto cadastrado. Comece adicionando uma loja ou importe uma base numa próxima etapa.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
